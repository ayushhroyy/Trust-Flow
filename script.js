const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
let referenceDescriptor;
let detectionInterval;
let currentIdentity = null;
let stream = null;
let verificationTimeout = null;
let countdownInterval = null;
let lastConfidenceScore = null;

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
}

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

    let userPath = '';
    if (currentIdentity.type === 'aadhar') {
        userPath = `userdata/${currentIdentity.value}/img.jpeg`;
    } else {
        const users = await getAllUsers();
        const user = users.find(u => u.phone_number === currentIdentity.value);
        if (!user) {
            statusDiv.innerText = 'User not found in database';
            alert('No user found with this phone number');
            return;
        }
        userPath = `userdata/${user.adhaar_id || user.aadhar_id}/img.jpeg`;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = userPath;

    img.onload = async () => {
        referenceImage.src = userPath;
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
        console.error('Failed to load reference image:', userPath);
        statusDiv.innerText = 'Could not load reference image';
        referenceDescriptor = null;
        startWebcamButton.disabled = true;
    };
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
        const response = await fetch('userdata/users_index.json');
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.log('No users index found, using fallback');
    }

    const users = [];
    const aadharFolders = ['449961503595', '744708230225'];

    for (const aadhar of aadharFolders) {
        try {
            const response = await fetch(`userdata/${aadhar}/details.json`);
            if (response.ok) {
                const user = await response.json();
                users.push(user);
            }
        } catch (error) {
            console.log(`Could not load user: ${aadhar}`);
        }
    }

    return users;
}

async function fetchUserDetails() {
    let aadharNumber = '';

    if (currentIdentity.type === 'aadhar') {
        aadharNumber = currentIdentity.value;
    } else {
        const users = await getAllUsers();
        const user = users.find(u => u.phone_number === currentIdentity.value);
        if (user) {
            aadharNumber = user.adhaar_id || user.aadhar_id;
        }
    }

    try {
        const response = await fetch(`userdata/${aadharNumber}/details.json`);
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

    const userDetails = {
        id: Date.now(),
        name: name,
        username: `${name.toLowerCase().replace(/\s+/g, '_')}_aadhar`,
        adhaar_id: aadhar,
        aadhar_id: aadhar,
        phone_number: phone
    };

    alert(`To add "${name}" to the database:\n\n1. Create folder: userdata/${aadhar}/\n2. Save the photo as: userdata/${aadhar}/img.jpeg\n3. Create file: userdata/${aadhar}/details.json\n\nContent for details.json:\n${JSON.stringify(userDetails, null, 2)}\n\nThis is a static app. For production, use a backend server.`);

    document.getElementById('adminName').value = '';
    document.getElementById('adminAadhar').value = '';
    document.getElementById('adminPhone').value = '';
    document.getElementById('adminPhoto').value = '';
    document.getElementById('photoPreview').innerHTML = '';
}

// =============================================
// Dashboard Functions - D1 Database Integration
// =============================================

// API base URL - change to your deployed worker URL in production
const API_BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:8787'  // Wrangler dev server
    : '';  // Same origin in production

const STORAGE_KEY = 'trustflow_verification_history'; // Fallback for localStorage

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

// Fetch verification history from D1 API
async function getVerificationHistoryFromAPI() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/logs?limit=100`);
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.warn('API not available, falling back to localStorage:', error);
    }
    // Fallback to localStorage
    return getVerificationHistoryLocal();
}

// localStorage fallback
function getVerificationHistoryLocal() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (error) {
        console.error('Error reading verification history:', error);
        return [];
    }
}

function saveVerificationHistoryLocal(history) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
        console.error('Error saving verification history:', error);
    }
}

// Log verification event to D1 API
async function logVerificationEvent(userData, success, confidenceScore) {
    const event = {
        userName: userData.userName || 'Unknown',
        aadhar: maskAadhar(userData.aadhar),
        phone: maskPhone(userData.phone),
        status: success ? 'success' : 'failed',
        confidenceScore: confidenceScore ? parseFloat(confidenceScore) : null,
        identityType: userData.identityType || 'unknown'
    };

    // Try API first
    try {
        const response = await fetch(`${API_BASE_URL}/api/logs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event)
        });
        if (response.ok) {
            console.log('Verification event logged to D1:', event);
            return;
        }
    } catch (error) {
        console.warn('API not available, saving to localStorage:', error);
    }

    // Fallback to localStorage
    const history = getVerificationHistoryLocal();
    const localEvent = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        ...event
    };
    history.unshift(localEvent);
    if (history.length > 100) history.pop();
    saveVerificationHistoryLocal(history);
    console.log('Verification event logged to localStorage:', localEvent);
}

// Get stats from D1 API
async function getVerificationStatsFromAPI() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/stats`);
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.warn('API not available, calculating from localStorage:', error);
    }
    // Fallback
    const history = getVerificationHistoryLocal();
    return {
        total: history.length,
        successful: history.filter(e => e.status === 'success').length,
        failed: history.filter(e => e.status === 'failed').length
    };
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
    // Show loading state
    document.getElementById('totalVerifications').textContent = '...';
    document.getElementById('successCount').textContent = '...';
    document.getElementById('failedCount').textContent = '...';

    const [stats, history] = await Promise.all([
        getVerificationStatsFromAPI(),
        getVerificationHistoryFromAPI()
    ]);

    // Update stats
    document.getElementById('totalVerifications').textContent = stats.total;
    document.getElementById('successCount').textContent = stats.successful;
    document.getElementById('failedCount').textContent = stats.failed;

    // Update table
    const tableBody = document.getElementById('historyTableBody');

    if (!history || history.length === 0) {
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
        const confidence = event.confidence_score || event.confidenceScore;
        const confidenceClass = getConfidenceClass(confidence);
        const confidenceText = confidence !== null && confidence !== undefined ? `${confidence}%` : 'N/A';
        const timestamp = event.created_at || event.timestamp;
        const aadhar = event.aadhar_masked || event.aadhar;
        const userName = event.user_name || event.userName;

        return `
            <tr>
                <td>${formatTimestamp(timestamp)}</td>
                <td>${userName}</td>
                <td>${aadhar}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td><span class="confidence-badge ${confidenceClass}">${confidenceText}</span></td>
            </tr>
        `;
    }).join('');
}

async function clearLoginHistory() {
    if (confirm('Are you sure you want to clear all verification history? This action cannot be undone.')) {
        // Try API first
        try {
            const response = await fetch(`${API_BASE_URL}/api/logs`, { method: 'DELETE' });
            if (response.ok) {
                console.log('Verification history cleared from D1');
                await populateDashboard();
                return;
            }
        } catch (error) {
            console.warn('API not available, clearing localStorage:', error);
        }

        // Fallback
        localStorage.removeItem(STORAGE_KEY);
        await populateDashboard();
        console.log('Verification history cleared from localStorage');
    }
}

// Expose dashboard functions to global scope for onclick handlers
window.goToDashboard = goToDashboard;
window.clearLoginHistory = clearLoginHistory;
