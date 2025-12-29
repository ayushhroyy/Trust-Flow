// Securify Worker API - Cloudflare D1 + R2 Backend
// Handles user management, image storage, and verification logging

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // Route handling
            if (path === '/api/users' && request.method === 'GET') {
                return await getAllUsers(env, corsHeaders);
            }

            if (path === '/api/users' && request.method === 'POST') {
                return await addUser(request, env, corsHeaders);
            }

            if (path.match(/^\/api\/users\/\d{12}$/) && request.method === 'GET') {
                const aadhar = path.split('/').pop();
                return await getUserByAadhar(aadhar, env, corsHeaders);
            }

            if (path.match(/^\/api\/users\/\d{12}$/) && request.method === 'DELETE') {
                const aadhar = path.split('/').pop();
                return await deleteUser(aadhar, env, corsHeaders);
            }

            if (path.match(/^\/api\/users\/phone\/\d{10}$/) && request.method === 'GET') {
                const phone = path.split('/').pop();
                return await getUserByPhone(phone, env, corsHeaders);
            }

            if (path.match(/^\/api\/image\/.+/) && request.method === 'GET') {
                const key = path.replace('/api/image/', '');
                return await getImage(key, env, corsHeaders);
            }

            if (path === '/api/verifications' && request.method === 'GET') {
                return await getVerifications(env, corsHeaders);
            }

            if (path === '/api/verifications' && request.method === 'POST') {
                return await logVerification(request, env, corsHeaders);
            }

            if (path === '/api/verifications' && request.method === 'DELETE') {
                return await clearVerifications(env, corsHeaders);
            }

            // API documentation for GET /
            if (path === '/' && request.method === 'GET') {
                return new Response(JSON.stringify({
                    service: 'Securify API',
                    version: '1.0.0',
                    endpoints: {
                        'GET /api/users': 'List all users',
                        'POST /api/users': 'Add new user (multipart/form-data with name, aadhar_id, phone_number, image)',
                        'GET /api/users/:aadhar': 'Get user by Aadhar',
                        'DELETE /api/users/:aadhar': 'Delete user',
                        'GET /api/users/phone/:phone': 'Get user by phone',
                        'GET /api/image/:key': 'Get user image',
                        'GET /api/verifications': 'Get verification history',
                        'POST /api/verifications': 'Log verification event',
                        'DELETE /api/verifications': 'Clear all verifications'
                    }
                }, null, 2), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });

        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }
};

// Get all users
async function getAllUsers(env, corsHeaders) {
    const result = await env.DB.prepare(
        'SELECT id, name, aadhar_id, phone_number, image_key, created_at FROM users ORDER BY created_at DESC'
    ).all();

    return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

// Get user by Aadhar
async function getUserByAadhar(aadhar, env, corsHeaders) {
    const result = await env.DB.prepare(
        'SELECT id, name, aadhar_id, phone_number, image_key, created_at FROM users WHERE aadhar_id = ?'
    ).bind(aadhar).first();

    if (!result) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

// Get user by phone
async function getUserByPhone(phone, env, corsHeaders) {
    const result = await env.DB.prepare(
        'SELECT id, name, aadhar_id, phone_number, image_key, created_at FROM users WHERE phone_number = ?'
    ).bind(phone).first();

    if (!result) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

// Add new user
async function addUser(request, env, corsHeaders) {
    const formData = await request.formData();

    const name = formData.get('name');
    const aadhar_id = formData.get('aadhar_id');
    const phone_number = formData.get('phone_number');
    const image = formData.get('image');

    // Validation
    if (!name || !aadhar_id || !phone_number || !image) {
        return new Response(JSON.stringify({
            error: 'Missing required fields: name, aadhar_id, phone_number, image'
        }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    if (!/^\d{12}$/.test(aadhar_id)) {
        return new Response(JSON.stringify({ error: 'Aadhar must be 12 digits' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    if (!/^\d{10}$/.test(phone_number)) {
        return new Response(JSON.stringify({ error: 'Phone must be 10 digits' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // Check if user already exists
    const existing = await env.DB.prepare(
        'SELECT id FROM users WHERE aadhar_id = ? OR phone_number = ?'
    ).bind(aadhar_id, phone_number).first();

    if (existing) {
        return new Response(JSON.stringify({ error: 'User with this Aadhar or phone already exists' }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // Upload image to R2
    const image_key = `users/${aadhar_id}/face.jpg`;
    const imageBuffer = await image.arrayBuffer();

    await env.IMAGES.put(image_key, imageBuffer, {
        httpMetadata: {
            contentType: image.type || 'image/jpeg'
        }
    });

    // Insert user into D1
    const result = await env.DB.prepare(
        'INSERT INTO users (name, aadhar_id, phone_number, image_key) VALUES (?, ?, ?, ?)'
    ).bind(name, aadhar_id, phone_number, image_key).run();

    return new Response(JSON.stringify({
        success: true,
        message: 'User added successfully',
        user: {
            id: result.meta.last_row_id,
            name,
            aadhar_id,
            phone_number,
            image_key
        }
    }), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

// Delete user
async function deleteUser(aadhar, env, corsHeaders) {
    // Get user first to find image key
    const user = await env.DB.prepare(
        'SELECT image_key FROM users WHERE aadhar_id = ?'
    ).bind(aadhar).first();

    if (!user) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // Delete image from R2
    await env.IMAGES.delete(user.image_key);

    // Delete user from D1
    await env.DB.prepare('DELETE FROM users WHERE aadhar_id = ?').bind(aadhar).run();

    return new Response(JSON.stringify({ success: true, message: 'User deleted' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

// Get image from R2
async function getImage(key, env, corsHeaders) {
    const object = await env.IMAGES.get(key);

    if (!object) {
        return new Response(JSON.stringify({ error: 'Image not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    const headers = new Headers(corsHeaders);
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=86400');

    return new Response(object.body, { headers });
}

// Get verification history
async function getVerifications(env, corsHeaders) {
    const result = await env.DB.prepare(
        'SELECT * FROM verifications ORDER BY timestamp DESC LIMIT 100'
    ).all();

    return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

// Log verification event
async function logVerification(request, env, corsHeaders) {
    const data = await request.json();

    const { user_name, aadhar_masked, phone_masked, status, confidence_score, identity_type } = data;

    if (!status || !['success', 'failed'].includes(status)) {
        return new Response(JSON.stringify({ error: 'Invalid status. Must be "success" or "failed"' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // Try to find user_id if aadhar is provided
    let user_id = null;
    if (aadhar_masked) {
        // Extract last 4 digits from masked aadhar (XXXX-XXXX-1234)
        const lastFour = aadhar_masked.split('-').pop();
        if (lastFour && /^\d{4}$/.test(lastFour)) {
            const user = await env.DB.prepare(
                "SELECT id FROM users WHERE aadhar_id LIKE ?"
            ).bind(`%${lastFour}`).first();
            if (user) user_id = user.id;
        }
    }

    const result = await env.DB.prepare(
        `INSERT INTO verifications (user_id, aadhar_masked, user_name, phone_masked, status, confidence_score, identity_type) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        user_id,
        aadhar_masked || null,
        user_name || 'Unknown',
        phone_masked || null,
        status,
        confidence_score || null,
        identity_type || null
    ).run();

    return new Response(JSON.stringify({
        success: true,
        id: result.meta.last_row_id
    }), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

// Clear all verifications
async function clearVerifications(env, corsHeaders) {
    await env.DB.prepare('DELETE FROM verifications').run();

    return new Response(JSON.stringify({ success: true, message: 'All verifications cleared' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}
