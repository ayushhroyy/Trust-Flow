const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
const API_BASE = 'https://trustflow-api.youtopialabs.workers.dev';

let referenceDescriptor;
let detectionInterval;
let currentIdentity = null;
let stream = null;
let verificationTimeout = null;
let countdownInterval = null;
let lastConfidenceScore = null;
let currentUserData = null;

const referenceImage = document.getElementById('referenceImage');
const video = document.getElementById('video');
const startWebcamButton = document.getElementById('startWebcamButton');
const statusDiv = document.getElementById('status');

async function loadModels() {
    try {
        console.log('Loading face-api models...');
        if (statusDiv) {
            statusDiv.innerText = 'Loading face recognition models...';
        }
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        console.log('All models loaded successfully');
        if (statusDiv) {
            statusDiv.innerText = 'Models loaded. Enter Aadhar/Phone to verify.';
        }
    } catch (error) {
        console.error('Error loading models:', error);
        if (statusDiv) {
            statusDiv.innerText = 'Error loading models. Refresh page.';
        }
        alert('Failed to load face recognition models. Please check your internet connection and try again.');
    }
}

document.addEventListener('DOMContentLoaded', loadModels);

function transitionScreen(fromScreen, toScreen) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    setTimeout(() => {
        document.getElementById(toScreen).classList.add('active');
    }, 200);
}

function goToVerification() {
    transitionScreen('welcomeScreen', 'inputScreen');
}

function goToAdmin() {
    transitionScreen('welcomeScreen', 'adminScreen');
    loadUsersList();
}

function switchAdminTab(tab) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(content => content.classList.remove('active'));

    if (tab === 'add') {
        document.querySelector('.tab-btn:first-child').classList.add('active');
        document.getElementById('addUserTab').classList.add('active');
    } else {
        document.querySelector('.tab-btn:last-child').classList.add('active');
        document.getElementById('viewUsersTab').classList.add('active');
        loadUsersList();
    }
}

async function loadUsersList() {
    const container = document.getElementById('usersListContent');
    container.innerHTML = '<p class="loading-text">Loading users...</p>';

    try {
        const users = await getAllUsers();

        if (users.length === 0) {
            container.innerHTML = '<p class="empty-users">No users in database yet</p>';
            return;
        }

        container.innerHTML = `
            <p class="user-count">${users.length} user${users.length !== 1 ? 's' : ''} registered</p>
            ${users.map(user => `
                <div class="user-card" data-aadhar="${user.aadhar_id}">
                    <img class="user-avatar" src="${API_BASE}/api/image/${user.image_key}" alt="${user.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23333%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 font-size=%2240%22 text-anchor=%22middle%22 fill=%22%23666%22>👤</text></svg>'">
                    <div class="user-info">
                        <div class="user-name">${user.name}</div>
                        <div class="user-details">
                            <span class="user-aadhar">XXXX-XXXX-${user.aadhar_id.slice(-4)}</span> · ${user.phone_number.slice(0, 2)}XXXXX${user.phone_number.slice(-3)}
                        </div>
                    </div>
                    <div class="user-actions">
                        <button class="delete-btn" onclick="deleteUser('${user.aadhar_id}', '${user.name}')">🗑️ Delete</button>
                    </div>
                </div>
            `).join('')}
        `;
    } catch (error) {
        console.error('Error loading users:', error);
        container.innerHTML = '<p class="empty-users">Error loading users</p>';
    }
}

async function deleteUser(aadhar, name) {
    if (!confirm(`Are you sure you want to delete "${name}"?\n\nThis will remove their data and photo permanently.`)) {
        return;
    }

    const card = document.querySelector(`.user-card[data-aadhar="${aadhar}"]`);
    const deleteBtn = card.querySelector('.delete-btn');
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';

    try {
        const response = await fetch(`${API_BASE}/api/users/${aadhar}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            card.style.opacity = '0';
            card.style.transform = 'translateX(20px)';
            setTimeout(() => {
                loadUsersList();
            }, 300);
        } else {
            const result = await response.json();
            alert(`Error: ${result.error || 'Failed to delete user'}`);
            deleteBtn.disabled = false;
            deleteBtn.textContent = '🗑️ Delete';
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        alert('Network error. Please try again.');
        deleteBtn.disabled = false;
        deleteBtn.textContent = '🗑️ Delete';
    }
}

window.switchAdminTab = switchAdminTab;
window.loadUsersList = loadUsersList;
window.deleteUser = deleteUser;

function goToDashboard() {
    populateDashboard();
    transitionScreen('welcomeScreen', 'dashboardScreen');
}

function goBack(fromScreen, toScreen) {
    stopWebcam();
    transitionScreen(fromScreen, toScreen);
}

function stopWebcam() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    if (detectionInterval) {
        clearInterval(detectionInterval);
        detectionInterval = null;
    }
    if (verificationTimeout) {
        clearTimeout(verificationTimeout);
        verificationTimeout = null;
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    const videoWrapper = document.getElementById('video-wrapper');
    const existingCanvas = videoWrapper.querySelector('canvas');
    if (existingCanvas) {
        existingCanvas.remove();
    }
    videoWrapper.classList.remove('match-fail');

    const verificationProgress = document.getElementById('verificationProgress');
    if (verificationProgress) {
        verificationProgress.style.display = 'none';
    }

    const timeoutProgress = document.getElementById('timeoutProgress');
    if (timeoutProgress) {
        timeoutProgress.style.display = 'none';
    }

    if (statusDiv) {
        statusDiv.style.display = 'block';
    }

    referenceDescriptor = null;
}

async function submitIdentity() {
    const input = document.getElementById('identityInput').value.trim();

    if (input.length === 12 && /^\d{12}$/.test(input)) {
        currentIdentity = { type: 'aadhar', value: input };
    } else if (input.length === 10 && /^\d{10}$/.test(input)) {
        currentIdentity = { type: 'phone', value: input };
    } else {
        alert('Please enter a valid 12-digit Aadhar number or 10-digit phone number');
        return;
    }

    resetVerificationProgress();
    transitionScreen('inputScreen', 'faceScreen');
    await loadReferenceImage();
}

function resetVerificationProgress() {
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');

    if (progressFill) {
        progressFill.style.width = '0%';
    }
    if (progressText) {
        progressText.innerText = 'Verifying...';
    }

    for (let i = 1; i <= 5; i++) {
        const dot = document.getElementById(`dot${i}`);
        if (dot) {
            dot.classList.remove('active', 'success');
        }
    }
}

async function loadReferenceImage() {
    statusDiv.innerText = 'Loading reference image...';
    startWebcamButton.disabled = true;
    referenceImage.src = '';
    referenceDescriptor = null;
    currentUserData = null;

    try {
        let user = null;

        if (currentIdentity.type === 'aadhar') {
            const response = await fetch(`${API_BASE}/api/users/${currentIdentity.value}`);
            if (response.ok) {
                user = await response.json();
            }
        } else {
            const response = await fetch(`${API_BASE}/api/users/phone/${currentIdentity.value}`);
            if (response.ok) {
                user = await response.json();
            }
        }

        if (!user) {
            statusDiv.innerText = 'User not found in database';
            alert('No user found with this identity');
            return;
        }

        currentUserData = user;
        const imageUrl = `${API_BASE}/api/image/${user.image_key}`;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = imageUrl;

        img.onload = async () => {
            referenceImage.src = imageUrl;
            try {
                console.log('Detecting face in reference image...');
                const detection = await faceapi.detectSingleFace(img)
                    .withFaceLandmarks()
                    .withFaceDescriptor();

                if (!detection) {
                    console.warn('No face detected in reference image');
                    statusDiv.innerText = 'No face found in reference image. Ensure image has a clear face.';
                    referenceDescriptor = null;
                    startWebcamButton.disabled = true;
                } else {
                    console.log('Face detected in reference image');
                    referenceDescriptor = detection.descriptor;
                    statusDiv.innerText = 'Reference image loaded! Click "Start Webcam" to verify.';
                    startWebcamButton.disabled = false;
                }
            } catch (error) {
                console.error('Error detecting face in reference image:', error);
                statusDiv.innerText = 'Error processing reference image';
                referenceDescriptor = null;
                startWebcamButton.disabled = true;
            }
        };

        img.onerror = () => {
            console.error('Failed to load reference image:', imageUrl);
            statusDiv.innerText = 'Could not load reference image';
            referenceDescriptor = null;
            startWebcamButton.disabled = true;
        };
    } catch (error) {
        console.error('Error loading reference image:', error);
        statusDiv.innerText = 'Error loading user data';
    }
}

startWebcamButton.addEventListener('click', async () => {
    statusDiv.innerText = 'Starting webcam...';
    startWebcamButton.disabled = true;
    startWebcamButton.querySelector('span').innerText = 'Starting...';

    const videoWrapper = document.getElementById('video-wrapper');
    videoWrapper.classList.remove('match-fail');

    resetVerificationProgress();

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            }
        });
        video.srcObject = stream;

        video.onloadedmetadata = () => {
            video.play();
            startWebcamButton.disabled = false;
            startWebcamButton.querySelector('span').innerText = 'Verifying...';
            console.log('Webcam started:', video.videoWidth, 'x', video.videoHeight);
        };
    } catch (err) {
        console.error('Webcam Error:', err);
        statusDiv.innerText = 'Camera access denied. Please allow camera permissions.';
        startWebcamButton.disabled = false;
        startWebcamButton.querySelector('span').innerText = 'Start Webcam';
        alert('Could not access webcam. Please ensure you have granted camera permissions in your browser settings.');
    }
});

video.addEventListener('play', async () => {
    statusDiv.innerText = 'Position your face in the frame...';

    const canvas = faceapi.createCanvasFromMedia(video);
    document.getElementById('video-wrapper').append(canvas);

    const videoWrapper = document.getElementById('video-wrapper');
    videoWrapper.classList.remove('match-fail');
    const displaySize = { width: videoWrapper.clientWidth, height: videoWrapper.clientHeight };
    faceapi.matchDimensions(canvas, displaySize);

    if (detectionInterval) {
        clearInterval(detectionInterval);
    }

    let consecutiveMatches = 0;
    const requiredMatches = 5;
    const timeoutDuration = 6000;
    const verificationProgress = document.getElementById('verificationProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const timeoutProgress = document.getElementById('timeoutProgress');
    const timeoutFill = document.getElementById('timeoutFill');
    const timeoutText = document.getElementById('timeoutText');

    function startTimeoutCountdown() {
        let timeRemaining = timeoutDuration;
        timeoutProgress.style.display = 'block';

        countdownInterval = setInterval(() => {
            timeRemaining -= 100;
            const percentage = (timeRemaining / timeoutDuration) * 100;
            timeoutFill.style.width = `${percentage}%`;
            timeoutText.innerText = `Time remaining: ${(timeRemaining / 1000).toFixed(1)}s`;
        }, 100);
    }

    function clearTimeoutCountdown() {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        if (verificationTimeout) {
            clearTimeout(verificationTimeout);
            verificationTimeout = null;
        }
        timeoutProgress.style.display = 'none';
    }

    verificationTimeout = setTimeout(async () => {
        clearInterval(detectionInterval);
        clearTimeoutCountdown();

        // Log failed verification (timeout)
        const userDetails = await fetchUserDetails();
        logVerificationEvent({
            userName: userDetails?.name || 'Unknown',
            aadhar: currentIdentity.type === 'aadhar' ? currentIdentity.value : (userDetails?.adhaar_id || userDetails?.aadhar_id || 'N/A'),
            phone: currentIdentity.type === 'phone' ? currentIdentity.value : (userDetails?.phone_number || 'N/A'),
            identityType: currentIdentity.type
        }, false, null);

        stopWebcam();
        statusDiv.innerText = 'Verification timed out. Face not verified within 6 seconds.';
        alert('Face verification timed out. Please try again.');
    }, timeoutDuration);

    startTimeoutCountdown();

    function updateVerificationProgress() {
        const progress = (consecutiveMatches / requiredMatches) * 100;
        progressFill.style.width = `${progress}%`;
        progressText.innerText = `Verifying... ${consecutiveMatches}/${requiredMatches}`;

        for (let i = 1; i <= 5; i++) {
            const dot = document.getElementById(`dot${i}`);
            if (i <= consecutiveMatches) {
                dot.classList.add('active');
                dot.classList.add('success');
                setTimeout(() => dot.classList.remove('success'), 500);
            } else {
                dot.classList.remove('active');
            }
        }
    }

    detectionInterval = setInterval(async () => {
        try {
            const detections = await faceapi.detectAllFaces(video)
                .withFaceLandmarks()
                .withFaceDescriptors();

            const resizedDetections = faceapi.resizeResults(detections, displaySize);
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (referenceDescriptor && resizedDetections.length > 0) {
                const faceMatcher = new faceapi.FaceMatcher([referenceDescriptor], 0.6);
                let matchFoundThisFrame = false;

                resizedDetections.forEach(d => {
                    const bestMatch = faceMatcher.findBestMatch(d.descriptor);
                    const box = d.detection.box;
                    const distance = bestMatch.distance;

                    // Calculate confidence score (convert distance to percentage)
                    // Lower distance = higher confidence
                    lastConfidenceScore = Math.max(0, (1 - distance) * 100).toFixed(1);

                    if (distance < 0.5) {
                        matchFoundThisFrame = true;
                    }
                });

                if (matchFoundThisFrame) {
                    consecutiveMatches++;
                    videoWrapper.classList.remove('match-fail');
                    verificationProgress.style.display = 'block';
                    statusDiv.style.display = 'none';
                    updateVerificationProgress();
                } else {
                    consecutiveMatches = 0;
                    videoWrapper.classList.add('match-fail');
                    verificationProgress.style.display = 'none';
                    statusDiv.style.display = 'block';
                    statusDiv.innerHTML = 'Face not matched.<br><br><strong>Tips:</strong><br>• Better lighting<br>• Remove glasses<br>• Look directly at camera';
                    updateVerificationProgress();
                }

                if (consecutiveMatches >= requiredMatches) {
                    clearTimeoutCountdown();
                    stopWebcam();
                    clearInterval(detectionInterval);
                    startWebcamButton.querySelector('span').innerText = 'Verified';
                    progressText.innerText = '✓ Verified!';

                    setTimeout(async () => {
                        const userDetails = await fetchUserDetails();
                        const userName = userDetails?.name || 'User';

                        // Log successful verification with confidence score
                        logVerificationEvent({
                            userName: userName,
                            aadhar: currentIdentity.type === 'aadhar' ? currentIdentity.value : (userDetails?.adhaar_id || userDetails?.aadhar_id || 'N/A'),
                            phone: currentIdentity.type === 'phone' ? currentIdentity.value : (userDetails?.phone_number || 'N/A'),
                            identityType: currentIdentity.type
                        }, true, lastConfidenceScore);

                        document.getElementById('verifiedUser').innerText = `Welcome, ${userName}!`;
                        transitionScreen('faceScreen', 'successScreen');
                        startWebcamButton.querySelector('span').innerText = 'Start Webcam';
                        verificationProgress.style.display = 'none';
                        statusDiv.style.display = 'block';
                    }, 1000);
                }
            } else if (!referenceDescriptor) {
                videoWrapper.classList.add('match-fail');
                verificationProgress.style.display = 'none';
                statusDiv.style.display = 'block';
                statusDiv.innerText = 'No reference image loaded';
            } else if (resizedDetections.length === 0) {
                videoWrapper.classList.add('match-fail');
                verificationProgress.style.display = 'none';
                statusDiv.style.display = 'block';
                statusDiv.innerText = 'No face detected. Move closer.';
            }
        } catch (error) {
            console.error('Detection error:', error);
        }
    }, 200);
});

async function getAllUsers() {
    try {
        const response = await fetch(`${API_BASE}/api/users`);
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('Error fetching users from API:', error);
    }
    return [];
}

async function fetchUserDetails() {
    // Use cached currentUserData if available
    if (currentUserData) {
        return currentUserData;
    }

    try {
        let response;
        if (currentIdentity.type === 'aadhar') {
            response = await fetch(`${API_BASE}/api/users/${currentIdentity.value}`);
        } else {
            response = await fetch(`${API_BASE}/api/users/phone/${currentIdentity.value}`);
        }

        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('Error fetching user details:', error);
    }
    return null;
}

document.getElementById('identityInput').addEventListener('input', function (e) {
    this.value = this.value.replace(/[^0-9]/g, '');
});

document.getElementById('adminAadhar').addEventListener('input', function (e) {
    this.value = this.value.replace(/[^0-9]/g, '');
});

document.getElementById('adminPhone').addEventListener('input', function (e) {
    this.value = this.value.replace(/[^0-9]/g, '');
});

document.getElementById('adminPhoto').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
            document.getElementById('photoPreview').innerHTML =
                `<img src="${event.target.result}" alt="Photo preview" style="max-width: 200px; border-radius: 8px;">`;
        };
        reader.readAsDataURL(file);
    }
});

async function addUser() {
    const name = document.getElementById('adminName').value.trim();
    const aadhar = document.getElementById('adminAadhar').value.trim();
    const phone = document.getElementById('adminPhone').value.trim();
    const photoInput = document.getElementById('adminPhoto');

    if (!name || !aadhar || !phone) {
        alert('Please fill in all required fields');
        return;
    }

    if (aadhar.length !== 12 || !/^\d{12}$/.test(aadhar)) {
        alert('Please enter a valid 12-digit Aadhar number');
        return;
    }

    if (phone.length !== 10 || !/^\d{10}$/.test(phone)) {
        alert('Please enter a valid 10-digit phone number');
        return;
    }

    if (!photoInput.files || photoInput.files.length === 0) {
        alert('Please upload a photo');
        return;
    }

    const photo = photoInput.files[0];

    // Show loading state
    const addButton = document.querySelector('#adminScreen .glow-button');
    const originalText = addButton.querySelector('span').innerText;
    addButton.disabled = true;
    addButton.querySelector('span').innerText = 'Adding...';

    try {
        const formData = new FormData();
        formData.append('name', name);
        formData.append('aadhar_id', aadhar);
        formData.append('phone_number', phone);
        formData.append('image', photo);

        const response = await fetch(`${API_BASE}/api/users`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            alert(`✓ User "${name}" added successfully!`);
            document.getElementById('adminName').value = '';
            document.getElementById('adminAadhar').value = '';
            document.getElementById('adminPhone').value = '';
            document.getElementById('adminPhoto').value = '';
            document.getElementById('photoPreview').innerHTML = '';
        } else {
            alert(`Error: ${result.error || 'Failed to add user'}`);
        }
    } catch (error) {
        console.error('Error adding user:', error);
        alert('Network error. Please check your connection and try again.');
    } finally {
        addButton.disabled = false;
        addButton.querySelector('span').innerText = originalText;
    }
}

// =============================================
// Dashboard Functions - Login History & Confidence Scores
// Now uses D1 database via Worker API
// =============================================

function maskAadhar(aadhar) {
    if (!aadhar || aadhar === 'N/A') return 'N/A';
    if (aadhar.length === 12) {
        return `XXXX-XXXX-${aadhar.slice(-4)}`;
    }
    return aadhar;
}

function maskPhone(phone) {
    if (!phone || phone === 'N/A') return 'N/A';
    if (phone.length === 10) {
        return `${phone.slice(0, 2)}XXXXX${phone.slice(-3)}`;
    }
    return phone;
}

async function logVerificationEvent(userData, success, confidenceScore) {
    const event = {
        user_name: userData.userName || 'Unknown',
        aadhar_masked: maskAadhar(userData.aadhar),
        phone_masked: maskPhone(userData.phone),
        status: success ? 'success' : 'failed',
        confidence_score: confidenceScore ? parseFloat(confidenceScore) : null,
        identity_type: userData.identityType || 'unknown'
    };

    try {
        const response = await fetch(`${API_BASE}/api/verifications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event)
        });

        if (response.ok) {
            console.log('Verification event logged to D1:', event);
        } else {
            console.error('Failed to log verification to D1');
        }
    } catch (error) {
        console.error('Error logging verification:', error);
    }
}

function formatTimestamp(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getConfidenceClass(score) {
    if (score === null || score === undefined) return 'na';
    if (score >= 70) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
}

async function populateDashboard() {
    const tableBody = document.getElementById('historyTableBody');

    // Show loading state
    tableBody.innerHTML = `
        <tr class="empty-row">
            <td colspan="5">Loading verification history...</td>
        </tr>
    `;

    try {
        const response = await fetch(`${API_BASE}/api/verifications`);
        const history = await response.json();

        // Calculate stats
        const total = history.length;
        const successful = history.filter(e => e.status === 'success').length;
        const failed = history.filter(e => e.status === 'failed').length;

        // Update stats
        document.getElementById('totalVerifications').textContent = total;
        document.getElementById('successCount').textContent = successful;
        document.getElementById('failedCount').textContent = failed;

        if (history.length === 0) {
            tableBody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="5">No verification history yet</td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = history.map(event => {
            const statusClass = event.status === 'success' ? 'success' : 'failed';
            const statusText = event.status === 'success' ? 'Success' : 'Failed';
            const confidenceClass = getConfidenceClass(event.confidence_score);
            const confidenceText = event.confidence_score !== null ? `${event.confidence_score}%` : 'N/A';

            return `
                <tr>
                    <td>${formatTimestamp(event.timestamp)}</td>
                    <td>${event.user_name || 'Unknown'}</td>
                    <td>${event.aadhar_masked || 'N/A'}</td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td><span class="confidence-badge ${confidenceClass}">${confidenceText}</span></td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading verifications:', error);
        tableBody.innerHTML = `
            <tr class="empty-row">
                <td colspan="5">Error loading history. Please try again.</td>
            </tr>
        `;
    }
}

async function clearLoginHistory() {
    if (confirm('Are you sure you want to clear all verification history? This action cannot be undone.')) {
        try {
            const response = await fetch(`${API_BASE}/api/verifications`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await populateDashboard();
                console.log('Verification history cleared from D1');
            } else {
                alert('Failed to clear history');
            }
        } catch (error) {
            console.error('Error clearing history:', error);
            alert('Network error. Please try again.');
        }
    }
}

// Expose dashboard functions to global scope for onclick handlers
window.goToDashboard = goToDashboard;
window.clearLoginHistory = clearLoginHistory;
