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

            // Aadhar card OCR endpoint
            if (path === '/api/scan-aadhar' && request.method === 'POST') {
                return await scanAadharCard(request, env, corsHeaders);
            }

            // API documentation for GET /
            if (path === '/' && request.method === 'GET') {
                return new Response(JSON.stringify({
                    service: 'Securify API',
                    version: '1.1.0',
                    endpoints: {
                        'GET /api/users': 'List all users',
                        'POST /api/users': 'Add new user (multipart/form-data with name, aadhar_id, phone_number, image)',
                        'GET /api/users/:aadhar': 'Get user by Aadhar',
                        'DELETE /api/users/:aadhar': 'Delete user',
                        'GET /api/users/phone/:phone': 'Get user by phone',
                        'GET /api/image/:key': 'Get user image',
                        'GET /api/verifications': 'Get verification history',
                        'POST /api/verifications': 'Log verification event',
                        'DELETE /api/verifications': 'Clear all verifications',
                        'POST /api/scan-aadhar': 'Extract Aadhar number from card image (multipart/form-data with image)'
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
    const phone_number = formData.get('phone_number') || null; // Optional
    const image = formData.get('image');

    // Validation - phone is now optional
    if (!name || !aadhar_id || !image) {
        return new Response(JSON.stringify({
            error: 'Missing required fields: name, aadhar_id, image'
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

    // Only validate phone if provided
    if (phone_number && !/^\d{10}$/.test(phone_number)) {
        return new Response(JSON.stringify({ error: 'Phone must be 10 digits if provided' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // Check if user already exists (by aadhar, or by phone if provided)
    let existingQuery = 'SELECT id FROM users WHERE aadhar_id = ?';
    let existingParams = [aadhar_id];

    if (phone_number) {
        existingQuery = 'SELECT id FROM users WHERE aadhar_id = ? OR phone_number = ?';
        existingParams = [aadhar_id, phone_number];
    }

    const existing = await env.DB.prepare(existingQuery).bind(...existingParams).first();

    if (existing) {
        return new Response(JSON.stringify({ error: 'User with this Aadhar already exists' }), {
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

// Scan Aadhar card using Gemini Vision API
async function scanAadharCard(request, env, corsHeaders) {
    try {
        const formData = await request.formData();
        const image = formData.get('image');

        if (!image) {
            return new Response(JSON.stringify({ error: 'No image provided' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Convert image to base64 (chunked to avoid stack overflow)
        const imageBuffer = await image.arrayBuffer();
        console.log('Image buffer size:', imageBuffer.byteLength, 'bytes');
        const uint8Array = new Uint8Array(imageBuffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.slice(i, i + chunkSize);
            binary += String.fromCharCode(...chunk);
        }
        const base64Image = btoa(binary);
        const mimeType = image.type || 'image/jpeg';
        console.log('Image MIME type:', mimeType);
        console.log('Base64 image length:', base64Image.length, 'characters');

        // Call OpenRouter API with GLM model
        console.log('Making API request to OpenRouter with model: google/gemini-2.5-flash...');
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://securify.app',
                'X-Title': 'Securify Aadhar Scanner'
            },
                body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: `Extract the FULL NAME and 12-digit AADHAR NUMBER from this Aadhar card image.

IMPORTANT: The Aadhar number is usually located at the BOTTOM of the card.
It is 12 digits in GROUPS OF 3 like: 7447 0823 0225 (three groups separated by spaces)
Your task: Find the 12-digit Aadhar number and report it WITHOUT ANY SPACES.

DO NOT return "NOT_FOUND" for the aadhar number. Search the entire image for ANY 12-digit number pattern and return it.

Return your answer in this JSON format:
{
  "name": "FULL NAME",
  "aadhar": "123456789012"
}

Rules:
- name: Extract the complete name as written (uppercase preferred)
- aadhar: Look at the BOTTOM of the card for the 12-digit number. It appears as three groups of 4 digits with spaces like "7447 0823 0225". Find it and return as exactly 12 consecutive digits with NO SPACES.
- CRITICAL: Never return "NOT_FOUND" for aadhar. Always try to extract a 12-digit number from the image.
- If you truly cannot find any 12-digit number, return an empty string "" for aadhar.
- Return ONLY the JSON, nothing else

Example valid response:
{"name": "RAJESH KUMAR SHARMA", "aadhar": "123456789012"}

Note: If you see "7447 0823 0225" or "7447-0823-0225", return "744708230225"`
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${mimeType};base64,${base64Image}`
                            }
                        }
                    ]
                }],
                max_tokens: 150,
                temperature: 0
            })
        });

        console.log('API response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenRouter API error:', response.status, errorText);
            return new Response(JSON.stringify({
                success: false,
                error: 'OCR service error',
                details: `API returned ${response.status}: ${errorText}`
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        const data = await response.json();
        console.log('Full API response:', JSON.stringify(data, null, 2));

        const extractedText = data.choices?.[0]?.message?.content?.trim() || '';
        console.log('Raw OCR response:', extractedText);
        console.log('Response length:', extractedText.length, 'characters');

        // Initialize extracted values
        let name = null;
        let aadhar = null;

        // Method 1: Direct JSON parse (most likely format)
        console.log('Method 1: Trying direct JSON parse...');
        try {
            const parsed = JSON.parse(extractedText);
            name = parsed.name;
            aadhar = parsed.aadhar || parsed.aadhar_number;

            // Check if NOT_FOUND
            if (aadhar === 'NOT_FOUND' || name === 'NOT_FOUND') {
                console.log('Model returned NOT_FOUND for:', { name, aadhar });
                if (aadhar === 'NOT_FOUND') aadhar = null;
                if (name === 'NOT_FOUND') name = null;
            } else {
                console.log('✓ Direct JSON parse succeeded:', { name, aadhar });
            }
        } catch (e1) {
            console.log('✗ Direct JSON parse failed with error:', e1.message);

            // Method 2: Extract JSON from markdown or mixed content
            console.log('Method 2: Trying to extract JSON from markdown/mixed content...');
            const jsonMatch = extractedText.match(/\{[^{}]*"[^"]*"[^{}]*"[^"]*"[^{}]*\}/) ||
                             extractedText.match(/\{[\s\S]*?\{[\s\S]*?\}[\s\S]*?\}/);

            console.log('JSON match result:', jsonMatch ? 'Found' : 'Not found');
            if (jsonMatch) {
                console.log('Matched JSON string:', jsonMatch[0]);
                try {
                    const nestedMatch = jsonMatch[0].match(/\{[\s\S]*?\}/);
                    if (nestedMatch) {
                        console.log('Nested JSON match:', nestedMatch[0]);
                        const parsed = JSON.parse(nestedMatch[0]);
                        name = parsed.name;
                        aadhar = parsed.aadhar || parsed.aadhar_number;
                        console.log('✓ Nested JSON parse succeeded:', { name, aadhar });
                    }
                } catch (e2) {
                    console.log('✗ Nested JSON parse failed with error:', e2.message);
                }
            }

            // Method 3: Regex for name and aadhar separately
            console.log('Method 3: Trying regex extraction for aadhar...');
            if (!aadhar) {
                const aadharMatch = extractedText.match(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/);
                if (aadharMatch) {
                    aadhar = aadharMatch[0].replace(/[\s-]/g, '');
                    console.log('✓ Extracted aadhar via dashed regex:', aadhar);
                } else {
                    const simpleAadhar = extractedText.match(/\d{12}/);
                    if (simpleAadhar) {
                        aadhar = simpleAadhar[0];
                        console.log('✓ Extracted aadhar via simple regex:', aadhar);
                    } else {
                        console.log('✗ No 12-digit aadhar found in response');
                    }
                }
            }

            console.log('Method 3: Trying regex extraction for name...');
            if (!name) {
                const nameMatch = extractedText.match(/"name"\s*:\s*"([^"]+)"/i);
                if (nameMatch) {
                    name = nameMatch[1];
                    console.log('✓ Extracted name via regex:', name);
                } else {
                    console.log('✗ No name found in response');
                }
            }
        }

        console.log('Final extracted values:', { name, aadhar });

        // Validate Aadhar is exactly 12 digits
        console.log('Validation: Checking if aadhar is valid...');
        console.log(' - aadhar value:', aadhar);
        console.log(' - aadhar type:', typeof aadhar);
        console.log(' - aadhar is NOT_FOUND:', aadhar === 'NOT_FOUND');
        console.log(' - aadhar is empty string:', aadhar === '');
        console.log(' - aadhar passes regex:', aadhar ? /^\d{12}$/.test(aadhar) : 'N/A');

        // Accept: 12-digit number, empty string (try again), but NOT NOT_FOUND
        if (aadhar && aadhar !== 'NOT_FOUND' && aadhar !== '' && /^\d{12}$/.test(aadhar)) {
            console.log('✓ Validation passed! Returning success.');
            return new Response(JSON.stringify({
                success: true,
                aadhar_number: aadhar,
                name: name && name !== 'NOT_FOUND' ? name : null,
                raw_response: extractedText
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        } else {
            console.error('✗ Validation failed! Could not extract valid Aadhar.');
            const failureReason = !aadhar ? 'No aadhar extracted' :
                                  aadhar === 'NOT_FOUND' ? 'Model returned NOT_FOUND' :
                                  aadhar === '' ? 'Model returned empty string' :
                                  !/^\d{12}$/.test(aadhar) ? 'Invalid aadhar format' : 'Unknown';
            console.error('Failure reason:', failureReason);
            console.error('Details:', {
                aadhar_value: aadhar,
                aadhar_type: typeof aadhar,
                name_value: name,
                raw_response_length: extractedText.length
            });
            return new Response(JSON.stringify({
                success: false,
                error: `Could not extract valid 12-digit Aadhar number from image (${failureReason})`,
                extracted_aadhar: aadhar,
                extracted_name: name,
                raw_response: extractedText
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    } catch (error) {
        console.error('✗ Scan error caught:', error);
        console.error('Error stack:', error.stack);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to process image',
            details: error.message,
            stack: error.stack
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
}
