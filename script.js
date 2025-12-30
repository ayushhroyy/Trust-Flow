const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
const API_BASE = 'https://trustflow-api.youtopialabs.workers.dev';

// Authorized admin Aadhar numbers
const AUTHORIZED_ADMINS = ['530785223307', '744708230225', '123456789012']; // Added an example one for testing if needed

// Global state
let allVerificationHistory = [];
let referenceDescriptor;
let detectionInterval;
let currentIdentity = null;
let stream = null;
let verificationTimeout = null;
let countdownInterval = null;
let lastConfidenceScore = null;
let currentUserData = null;
let adminStream = null;
let adminDetectionInterval = null;
let adminReferenceDescriptor = null;
let isAdminAuthenticated = false;

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
        const verifications = await getVerificationHistory();

        // Calculate trust score for each user
        const usersWithTrustScore = users.map(user => {
            const userVerifications = verifications.filter(v =>
                v.aadhar_masked === user.aadhar_id || v.aadhar === user.aadhar_id
            );

            const successful = userVerifications.filter(v => v.status === 'success').length;
            const failed = userVerifications.filter(v => v.status === 'failed').length;
            const total = successful + failed;

            // Calculate trust score: start at 50, add 5 per success, subtract 10 per failure
            let trustScore = 50 + (successful * 5) - (failed * 10);

            // Keep score between 0 and 100
            trustScore = Math.max(0, Math.min(100, trustScore));

            return {
                ...user,
                trustScore,
                successfulVerifications: successful,
                failedVerifications: failed,
                totalVerifications: total
            };
        });

        if (users.length === 0) {
            container.innerHTML = '<p class="empty-users">No users in database yet</p>';
            return;
        }

        container.innerHTML = `
            <p class="user-count">${users.length} user${users.length !== 1 ? 's' : ''} registered</p>
            ${usersWithTrustScore.map(user => `
                <div class="user-card" data-aadhar="${user.aadhar_id}">
                    <img class="user-avatar" src="${API_BASE}/api/image/${user.image_key}" alt="${user.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23333%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 font-size=%2240%22 text-anchor=%22middle%22 fill=%22%23666%22>👤</text></svg>'">
                    <div class="user-info">
                        <div class="user-name">${user.name}</div>
                        <div class="user-details">
                            <span class="user-aadhar">XXXX-XXXX-${user.aadhar_id.slice(-4)}</span> · ${user.phone_number.slice(0, 2)}XXXXX${user.phone_number.slice(-3)}
                        </div>
                        <div class="trust-score-section">
                            <div class="trust-score-label">Trust Score</div>
                            <div class="trust-score-value ${getTrustScoreClass(user.trustScore)}">${user.trustScore}%</div>
                        </div>
                        <div class="verification-stats">
                            <span class="stat-success">✓ ${user.successfulVerifications}</span>
                            <span class="stat-failed">✗ ${user.failedVerifications}</span>
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

function getTrustScoreClass(score) {
    if (score >= 70) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
}

async function getVerificationHistory() {
    try {
        const response = await fetch(`${API_BASE}/api/verifications`);
        if (response.ok) {
            return await response.json();
        }
        return [];
    } catch (error) {
        console.error('Error fetching verification history:', error);
        return [];
    }
}

window.getTrustScoreClass = getTrustScoreClass;
window.getVerificationHistory = getVerificationHistory;


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

// =============================================
// Admin Authentication Functions
// =============================================

function goToAdminAuth() {
    isAdminAuthenticated = false;
    document.getElementById('adminAuthAadhar').value = '';
    transitionScreen('welcomeScreen', 'adminAuthScreen');
}

async function startAdminVerification() {
    const aadhar = document.getElementById('adminAuthAadhar').value.trim();

    if (aadhar.length !== 12 || !/^\d{12}$/.test(aadhar)) {
        alert('Please enter a valid 12-digit Aadhar number');
        return;
    }

    if (!AUTHORIZED_ADMINS.includes(aadhar)) {
        alert('❌ Access Denied\n\nThis Aadhar number is not authorized to manage the database.');
        return;
    }

    // Check if user exists in database
    try {
        const response = await fetch(`${API_BASE}/api/users/${aadhar}`);
        if (!response.ok) {
            alert('Admin not found in database. Please register first.');
            return;
        }

        const user = await response.json();
        currentUserData = user;

        transitionScreen('adminAuthScreen', 'adminFaceScreen');
        await loadAdminReferenceImage(user);
    } catch (error) {
        console.error('Error verifying admin:', error);
        alert('Network error. Please try again.');
    }
}

async function loadAdminReferenceImage(user) {
    const adminStatus = document.getElementById('adminStatus');
    const adminStartBtn = document.getElementById('adminStartWebcamBtn');
    const adminRefImage = document.getElementById('adminReferenceImage');

    adminStatus.innerText = 'Loading your photo...';
    adminStartBtn.disabled = true;
    adminReferenceDescriptor = null;

    const imageUrl = `${API_BASE}/api/image/${user.image_key}`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;

    img.onload = async () => {
        adminRefImage.src = imageUrl;
        try {
            const detection = await faceapi.detectSingleFace(img)
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (!detection) {
                adminStatus.innerText = 'No face found in reference. Contact support.';
                return;
            }

            adminReferenceDescriptor = detection.descriptor;
            adminStatus.innerText = 'Ready! Click "Start Webcam" to verify.';
            adminStartBtn.disabled = false;
        } catch (error) {
            console.error('Error processing admin image:', error);
            adminStatus.innerText = 'Error processing image.';
        }
    };

    img.onerror = () => {
        adminStatus.innerText = 'Could not load your photo.';
    };
}

document.getElementById('adminStartWebcamBtn')?.addEventListener('click', async () => {
    const adminStatus = document.getElementById('adminStatus');
    const adminVideo = document.getElementById('adminVideo');
    const adminBtn = document.getElementById('adminStartWebcamBtn');

    adminStatus.innerText = 'Starting webcam...';
    adminBtn.disabled = true;

    try {
        adminStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
        adminVideo.srcObject = adminStream;

        adminVideo.onloadedmetadata = () => {
            adminVideo.play();
            adminStatus.innerText = 'Position your face...';
            startAdminFaceDetection();
        };
    } catch (err) {
        console.error('Webcam error:', err);
        adminStatus.innerText = 'Camera access denied.';
        adminBtn.disabled = false;
    }
});

function startAdminFaceDetection() {
    const adminVideo = document.getElementById('adminVideo');
    const adminStatus = document.getElementById('adminStatus');
    let matchCount = 0;

    adminDetectionInterval = setInterval(async () => {
        try {
            const detections = await faceapi.detectAllFaces(adminVideo)
                .withFaceLandmarks()
                .withFaceDescriptors();

            if (adminReferenceDescriptor && detections.length > 0) {
                const faceMatcher = new faceapi.FaceMatcher([adminReferenceDescriptor], 0.6);

                for (const d of detections) {
                    const match = faceMatcher.findBestMatch(d.descriptor);
                    if (match.distance < 0.5) {
                        matchCount++;
                        adminStatus.innerText = `Verifying... ${matchCount}/3`;

                        if (matchCount >= 3) {
                            clearInterval(adminDetectionInterval);
                            stopAdminWebcam();
                            isAdminAuthenticated = true;
                            adminStatus.innerText = '✓ Authenticated!';

                            setTimeout(() => {
                                goToAdmin();
                            }, 800);
                            return;
                        }
                    } else {
                        matchCount = 0;
                        adminStatus.innerText = 'Face not matched. Try again.';
                    }
                }
            } else if (detections.length === 0) {
                adminStatus.innerText = 'No face detected. Move closer.';
            }
        } catch (error) {
            console.error('Detection error:', error);
        }
    }, 300);
}

function stopAdminWebcam() {
    if (adminStream) {
        adminStream.getTracks().forEach(track => track.stop());
        adminStream = null;
    }
    if (adminDetectionInterval) {
        clearInterval(adminDetectionInterval);
        adminDetectionInterval = null;
    }
}

function cancelAdminAuth() {
    stopAdminWebcam();
    isAdminAuthenticated = false;
    transitionScreen('adminFaceScreen', 'welcomeScreen');
}

function goToAdmin() {
    if (!isAdminAuthenticated) {
        goToAdminAuth();
        return;
    }
    transitionScreen('adminFaceScreen', 'adminScreen');
    loadUsersList();
}

window.goToAdminAuth = goToAdminAuth;
window.startAdminVerification = startAdminVerification;
window.cancelAdminAuth = cancelAdminAuth;

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
                    if (verificationTimeout) {
                        clearTimeout(verificationTimeout);
                        verificationTimeout = null;
                    }
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

// =============================================
// Aadhar Scanner Functions
// =============================================

let addUserWebcamStream = null;
let capturedPhotoBlob = null;

function openAadharScanner() {
    document.getElementById('aadharScannerModal').style.display = 'flex';
    document.getElementById('scanPreview').innerHTML = '';
    document.getElementById('scanningIndicator').style.display = 'none';
}

function closeAadharScanner() {
    document.getElementById('aadharScannerModal').style.display = 'none';
    // Reset Aadhar webcam state
    stopAadharWebcam();
    aadharCapturedPhotoBlob = null;
}

async function processAadharCard(input) {
    const file = input.files[0];
    if (!file) return;

    const scanPreview = document.getElementById('scanPreview');
    const scanningIndicator = document.getElementById('scanningIndicator');
    const scanStatus = document.getElementById('scanStatus');

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
        scanPreview.innerHTML = `<img src="${e.target.result}" alt="Aadhar card">`;
    };
    reader.readAsDataURL(file);

    // Show scanning indicator
    scanningIndicator.style.display = 'flex';

    try {
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch(`${API_BASE}/api/scan-aadhar`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        console.log('Scan result from server:', result);

        if (result.success && result.aadhar_number) {
            document.getElementById('adminAadhar').value = result.aadhar_number;

            if (result.name) {
                document.getElementById('adminName').value = result.name;
                scanStatus.textContent = `✓ Extracted: ${result.name} | ${result.aadhar_number}`;
            } else {
                scanStatus.textContent = `✓ Extracted Aadhar: ${result.aadhar_number}`;
            }
            scanStatus.className = 'scan-status';
            closeAadharScanner();
        } else {
            console.error('Scan failed with details:', result);
            scanStatus.textContent = `✗ ${result.error || 'Could not extract Aadhar'}`;
            if (result.extracted_aadhar || result.extracted_name) {
                scanStatus.textContent += ` (Found: ${result.extracted_name || 'N/A'}, ${result.extracted_aadhar || 'N/A'})`;
            }
            scanStatus.className = 'scan-status error';
        }
    } catch (error) {
        console.error('Scan error:', error);
        scanStatus.textContent = '✗ Scan failed. Try again.';
        scanStatus.className = 'scan-status error';
    } finally {
        scanningIndicator.style.display = 'none';
        input.value = ''; // Reset file input
    }
}

function togglePhotoSource(source) {
    const uploadSection = document.getElementById('uploadPhotoSection');
    const webcamSection = document.getElementById('webcamPhotoSection');
    const photoPreview = document.getElementById('photoPreview');

    if (source === 'upload') {
        uploadSection.style.display = 'block';
        webcamSection.style.display = 'none';
        stopAddUserWebcam();
        capturedPhotoBlob = null;
    } else {
        uploadSection.style.display = 'none';
        webcamSection.style.display = 'block';
        startAddUserWebcam();
    }
    photoPreview.innerHTML = '';
}

async function startAddUserWebcam() {
    try {
        addUserWebcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
        document.getElementById('addUserVideo').srcObject = addUserWebcamStream;
    } catch (err) {
        console.error('Webcam error:', err);
        alert('Could not access webcam');
        document.querySelector('input[name="photoSource"][value="upload"]').checked = true;
        togglePhotoSource('upload');
    }
}

function stopAddUserWebcam() {
    if (addUserWebcamStream) {
        addUserWebcamStream.getTracks().forEach(track => track.stop());
        addUserWebcamStream = null;
    }
}

function captureWebcamPhoto() {
    const video = document.getElementById('addUserVideo');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
        capturedPhotoBlob = blob;
        const url = URL.createObjectURL(blob);
        document.getElementById('photoPreview').innerHTML =
            `<img src="${url}" alt="Captured photo">`;
        stopAddUserWebcam();

        // Show success message
        const webcamSection = document.getElementById('webcamPhotoSection');
        webcamSection.innerHTML = `
            <p style="color: #10b981; text-align: center;">✓ Photo captured!</p>
            <button class="secondary-button" onclick="retakePhoto()">
                <span>🔄 Retake</span>
            </button>
        `;
    }, 'image/jpeg', 0.9);
}

function retakePhoto() {
    capturedPhotoBlob = null;
    document.getElementById('photoPreview').innerHTML = '';
    document.getElementById('webcamPhotoSection').innerHTML = `
        <div id="addUserWebcamWrapper">
            <video id="addUserVideo" autoplay muted playsinline></video>
        </div>
        <button class="secondary-button capture-btn" onclick="captureWebcamPhoto()">
            <span>📸 Capture Photo</span>
        </button>
    `;
    startAddUserWebcam();
}

window.openAadharScanner = openAadharScanner;
window.closeAadharScanner = closeAadharScanner;
window.processAadharCard = processAadharCard;

// Aadhar Scanner Webcam Functions
let aadharWebcamStream = null;
let aadharCapturedPhotoBlob = null;

function toggleAadharPhotoSource(source) {
    const uploadSection = document.getElementById('uploadAadharSection');
    const webcamSection = document.getElementById('webcamAadharSection');
    const preview = document.getElementById('scanPreview');

    if (source === 'upload') {
        uploadSection.style.display = 'block';
        webcamSection.style.display = 'none';
        stopAadharWebcam();
        aadharCapturedPhotoBlob = null;
    } else {
        uploadSection.style.display = 'none';
        webcamSection.style.display = 'block';
        startAadharWebcam();
    }
    preview.innerHTML = '';
}

async function startAadharWebcam() {
    try {
        aadharWebcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
        const video = document.getElementById('aadharVideo');
        video.srcObject = aadharWebcamStream;
    } catch (err) {
        console.error('Aadhar webcam error:', err);
        alert('Could not access webcam');
        document.querySelector('input[name="aadharPhotoSource"][value="upload"]').checked = true;
        toggleAadharPhotoSource('upload');
    }
}

function stopAadharWebcam() {
    if (aadharWebcamStream) {
        aadharWebcamStream.getTracks().forEach(track => track.stop());
        aadharWebcamStream = null;
    }
}

function captureAadharWebcamPhoto() {
    const video = document.getElementById('aadharVideo');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
        aadharCapturedPhotoBlob = blob;
        const url = URL.createObjectURL(blob);
        document.getElementById('scanPreview').innerHTML = `<img src="${url}" alt="Captured Aadhar card">`;
        stopAadharWebcam();

        // Update scanner content
        const webcamSection = document.getElementById('webcamAadharSection');
        webcamSection.innerHTML = `
            <p style="color: #10b981; text-align: center;">✓ Photo captured!</p>
            <button class="secondary-button" onclick="retakeAadharPhoto()">
                <span>🔄 Retake</span>
            </button>
        `;
    }, 'image/jpeg', 0.9);
}

function retakeAadharPhoto() {
    aadharCapturedPhotoBlob = null;
    document.getElementById('scanPreview').innerHTML = '';
    document.getElementById('webcamAadharSection').innerHTML = `
        <div id="aadharWebcamWrapper">
            <video id="aadharVideo" autoplay muted playsinline></video>
        </div>
        <button class="secondary-button capture-btn" onclick="captureAadharWebcamPhoto()">
            <span>📸 Capture</span>
        </button>
    `;
    startAadharWebcam();
}

function handleAadharImageSelect(input) {
    const file = input.files[0];
    if (!file) return;

    const scanPreview = document.getElementById('scanPreview');
    const scanningIndicator = document.getElementById('scanningIndicator');
    const scanStatus = document.getElementById('scanStatus');

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
        scanPreview.innerHTML = `<img src="${e.target.result}" alt="Aadhar card">`;
    };
    reader.readAsDataURL(file);
}

function proceedAadharExtraction() {
    const scanPreview = document.getElementById('scanPreview');
    const previewImg = scanPreview.querySelector('img');

    if (!previewImg || !aadharCapturedPhotoBlob) {
        alert('Please upload or capture a photo first');
        return;
    }

    // Determine which image to use
    const imageToProcess = aadharCapturedPhotoBlob || previewImg.src;

    processAadharImage(imageToProcess);
}
}

async function processAadharImage(imageData) {
    const scanStatus = document.getElementById('scanStatus');
    const scanningIndicator = document.getElementById('scanningIndicator');

    scanningIndicator.style.display = 'flex';

    try {
        const formData = new FormData();
        if (imageData instanceof Blob) {
            formData.append('image', imageData, 'aadhar_card.jpg');
        } else {
            formData.append('image', imageData);
        }

        const response = await fetch(`${API_BASE}/api/scan-aadhar`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        console.log('Scan result from server:', result);

        if (result.success && result.aadhar_number) {
            document.getElementById('adminAadhar').value = result.aadhar_number;

            if (result.name) {
                document.getElementById('adminName').value = result.name;
                scanStatus.textContent = `✓ Extracted: ${result.name} | ${result.aadhar_number}`;
            } else {
                scanStatus.textContent = `✓ Extracted Aadhar: ${result.aadhar_number}`;
            }
            scanStatus.className = 'scan-status';
            closeAadharScanner();
        } else {
            console.error('Scan failed with details:', result);
            scanStatus.textContent = `✗ ${result.error || 'Could not extract Aadhar'}`;
            if (result.extracted_aadhar || result.extracted_name) {
                scanStatus.textContent += ` (Found: ${result.extracted_name || 'N/A'}, ${result.extracted_aadhar || 'N/A'})`;
            }
            scanStatus.className = 'scan-status error';
        }
    } catch (error) {
        console.error('Scan error:', error);
        scanStatus.textContent = '✗ Scan failed. Try again.';
        scanStatus.className = 'scan-status error';
    } finally {
        scanningIndicator.style.display = 'none';
    }
}

window.togglePhotoSource = togglePhotoSource;
window.captureWebcamPhoto = captureWebcamPhoto;
window.retakePhoto = retakePhoto;

async function addUser() {
    const name = document.getElementById('adminName').value.trim();
    const aadhar = document.getElementById('adminAadhar').value.trim();
    const phone = document.getElementById('adminPhone').value.trim();
    const photoInput = document.getElementById('adminPhoto');
    const facePhotoSource = document.querySelector('input[name="photoSource"]:checked')?.value || 'upload';
    const aadharPhotoSource = document.querySelector('input[name="aadharPhotoSource"]:checked')?.value || 'upload';

    if (!name || !aadhar) {
        alert('Please fill in Name and Aadhar number');
        return;
    }

    if (aadhar.length !== 12 || !/^\d{12}$/.test(aadhar)) {
        alert('Please enter a valid 12-digit Aadhar number');
        return;
    }

    // Phone is optional, but validate if provided
    if (phone && (phone.length !== 10 || !/^\d{10}$/.test(phone))) {
        alert('Phone number must be 10 digits if provided');
        return;
    }

    // Get face photo based on source
    let facePhoto;
    if (facePhotoSource === 'webcam') {
        if (!capturedPhotoBlob) {
            alert('Please capture a face photo');
            return;
        }
        facePhoto = capturedPhotoBlob;
    } else {
        if (!photoInput.files || photoInput.files.length === 0) {
            alert('Please upload a face photo');
            return;
        }
        facePhoto = photoInput.files[0];
    }

    // Get Aadhar photo based on source
    let aadharPhoto = null;
    if (aadharPhotoSource === 'webcam') {
        if (!aadharCapturedPhotoBlob) {
            alert('Please capture Aadhar card photo');
            return;
        }
        aadharPhoto = aadharCapturedPhotoBlob;
    } else {
        if (!photoInput.files || photoInput.files.length === 0) {
            alert('Please upload Aadhar card photo');
            return;
        }
        aadharPhoto = photoInput.files[0];
    }

    // Show loading state
    const addButton = document.querySelector('#addUserTab .glow-button');
    const originalText = addButton.querySelector('span').innerText;
    addButton.disabled = true;
    addButton.querySelector('span').innerText = 'Adding...';

    try {
        const formData = new FormData();
        formData.append('name', name);
        formData.append('aadhar_id', aadhar);
        if (phone) formData.append('phone_number', phone);
        formData.append('image', facePhoto);

        // If Aadhar photo was captured separately, append it too
        if (aadharPhoto && aadharPhotoSource === 'webcam') {
            formData.append('aadhar_card', aadharPhoto);
        }
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
            document.getElementById('scanStatus').textContent = '';
            capturedPhotoBlob = null;

            // Reset photo source to upload
            document.querySelector('input[name="photoSource"][value="upload"]').checked = true;
            togglePhotoSource('upload');
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
    const historyList = document.getElementById('historyTableBody');
    const historyCountEl = document.getElementById('historyCount');
    const successRateEl = document.getElementById('successRate');

    // Show loading state
    historyList.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">⏳</div>
            <p>Loading verification history...</p>
        </div>
    `;

    try {
        const response = await fetch(`${API_BASE}/api/verifications`);
        allVerificationHistory = await response.json();

        // Calculate stats
        const total = allVerificationHistory.length;
        const successful = allVerificationHistory.filter(e => e.status === 'success').length;
        const failed = allVerificationHistory.filter(e => e.status === 'failed').length;
        const successRate = total > 0 ? Math.round((successful / total) * 100) : 0;

        // Update stats
        document.getElementById('totalVerifications').textContent = total;
        document.getElementById('successCount').textContent = successful;
        document.getElementById('failedCount').textContent = failed;

        // Update success rate
        if (successRateEl) {
            successRateEl.textContent = total > 0 ? `${successRate}% success` : '--';
            successRateEl.style.color = successRate >= 70 ? '#10b981' : successRate >= 50 ? '#eab308' : '#ef4444';
        }

        // Apply filters (initial render)
        filterDashboard();

    } catch (error) {
        console.error('Error loading verifications:', error);
        historyList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <p>Error loading history</p>
                <span class="empty-hint">Please try again</span>
            </div>
        `;
    }
}

function filterDashboard() {
    const searchTerm = document.getElementById('historySearch')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || 'all';
    const timeFilter = document.getElementById('timeFilter')?.value || 'all';

    let filtered = [...allVerificationHistory];

    // Status filter
    if (statusFilter !== 'all') {
        filtered = filtered.filter(e => e.status === statusFilter);
    }

    // Time filter
    if (timeFilter !== 'all') {
        const now = new Date();
        const startOfDay = new Date(now.setHours(0, 0, 0, 0));
        const startOfWeek = new Date(now.setDate(now.getDate() - 7));

        if (timeFilter === 'today') {
            filtered = filtered.filter(e => new Date(e.timestamp) >= startOfDay);
        } else if (timeFilter === 'week') {
            filtered = filtered.filter(e => new Date(e.timestamp) >= startOfWeek);
        }
    }

    // Search filter
    if (searchTerm) {
        filtered = filtered.filter(e =>
            (e.user_name?.toLowerCase().includes(searchTerm)) ||
            (e.aadhar_masked?.toLowerCase().includes(searchTerm))
        );
    }

    renderHistoryList(filtered);
}

function renderHistoryList(history) {
    const historyList = document.getElementById('historyTableBody');
    const historyCountEl = document.getElementById('historyCount');

    if (historyCountEl) {
        historyCountEl.textContent = `${history.length} record${history.length !== 1 ? 's' : ''}`;
    }

    if (history.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <p>No records found</p>
                <span class="empty-hint">Try adjusting your filters</span>
            </div>
        `;
        return;
    }

    historyList.innerHTML = history.map(event => {
        const statusClass = event.status === 'success' ? 'success' : 'failed';
        const statusIcon = event.status === 'success' ? '✓' : '✗';
        const confidenceClass = getConfidenceClass(event.confidence_score);
        const confidenceText = event.confidence_score !== null ? `${event.confidence_score}%` : 'N/A';

        return `
            <div class="history-item">
                <div class="history-avatar ${statusClass}">${statusIcon}</div>
                <div class="history-info">
                    <div class="history-name">${event.user_name || 'Unknown'}</div>
                    <div class="history-meta">
                        <span class="history-aadhar">${event.aadhar_masked || 'N/A'}</span>
                        <span class="history-time">· ${formatTimestamp(event.timestamp)}</span>
                    </div>
                </div>
                <div class="history-right">
                    <div class="history-confidence ${confidenceClass}">${confidenceText}</div>
                    <div class="history-status ${statusClass}">${event.status}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function clearLoginHistory() {
    if (confirm('Are you sure you want to clear all verification history? This action cannot be undone.')) {
        try {
            const response = await fetch(`${API_BASE}/api/verifications`, {
                method: 'DELETE'
            });

            if (response.ok) {
                allVerificationHistory = [];
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


