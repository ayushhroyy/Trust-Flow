# Securify

A robust identity verification system leveraging Cloudflare Workers, D1 Database, R2 Storage, and face-api.js for real-time face recognition.

## 🚀 Live Demo
The application is deployed on Cloudflare Pages.

## ✨ Key Features

- **Multi-Factor Verification**: Verify identities using Aadhar numbers or Phone numbers combined with real-time biometric face matching.
- **Biometric Face Recognition**: Uses `face-api.js` (SSD MobileNet V1) for high-accuracy face detection and 128-dimensional face descriptors.
- **Aadhar OCR Scanner**: Integrated Google Gemini 2.5 Flash Lite (via OpenRouter) to automatically extract 12-digit Aadhar numbers from uploaded images.
- **Biometric Admin Access**: The "Manage Database" section is secured by both Aadhar authorization and 3-consecutive-match face verification for administrators.
- **Analytics Dashboard**: Real-time insights into verification success rates, recent activity logs, and confidence scores.
- **Advanced Data Management**: Comprehensive interface for adding/deleting users with support for webcam photo capture and Aadhar scanning.

## 🛠 Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3 (Glassmorphism UI)
- **Face Recognition**: [face-api.js](https://github.com/justadudewhohacks/face-api.js/)
- **OCR AI**: Google Gemini 2.5 Flash Lite (via OpenRouter API)
- **Backend Architecture**: Cloudflare Workers (Edge Computing)
- **Database**: Cloudflare D1 (Serverless SQL)
- **Object Storage**: Cloudflare R2 (Storing Reference Photos)
- **deployment**: Cloudflare Pages

## 📐 Architecture

1. **Identity Request**: User provides Aadhar/Phone.
2. **Reference Fetch**: Worker fetches metadata from D1 and signed image URL from R2.
3. **Face Matching**: Client-side face-api.js performs matching against the reference.
4. **Logging**: Verification results and confidence scores are persisted back to D1 for analytics.

## 🔒 Security

- **Restricted Admin**: Only specific Aadhar numbers can initiate admin login.
- **Liveness Check**: Requires 5 consecutive matched frames for user verification (3 for admin).
- **Masked Data**: PII (Aadhar/Phone) is masked in logs and dashboard views.
- **Secrets Management**: API keys (OpenRouter/Gemini) are stored as Cloudflare Worker Secrets.

## 📦 Local Development

1. **Install Wrangler**: `npm install -g wrangler`
2. **Login**: `wrangler login`
3. **Deploy Worker**: `cd trustflow-worker && wrangler deploy` (Use existing D1/R2 bindings in `wrangler.toml`)
4. **Run Frontend**: Use any local server (e.g., `python3 -m http.server 8080`)

## 📄 License
This project is for demonstration purposes. All biometric data should be handled according to local data protection regulations.
