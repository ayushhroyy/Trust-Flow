# TrustFlow

A secure identity verification system using face recognition and Aadhar/phone number authentication.

## Features

- **Identity Verification**: Verify users using Aadhar number or phone number
- **Face Recognition**: Real-time face matching using face-api.js
- **Database Management**: Add new users to the verification database
- **Simple UI**: Clean, modern interface with glassmorphism design

## How It Works

1. **Verification Flow**:
   - Enter Aadhar (12 digits) or Phone (10 digits)
   - System loads reference image from database
   - Face matching via webcam
   - Success/failure notification

2. **Database Structure**:
   - Each user has a folder in `userdata/` named by their Aadhar number
   - Each folder contains:
     - `details.json`: User information
     - `img.jpeg`: Reference photo for face matching

## Adding Users

### Manual Method (Recommended)

1. Create a folder in `userdata/` with Aadhar number as name:
   ```
   userdata/123456789012/
   ```

2. Add user details in `details.json`:
   ```json
   {
     "id": 1,
     "name": "John Doe",
     "username": "john_doe",
     "aadhar_id": "123456789012",
     "phone_number": "9876543210"
   }
   ```

3. Add photo as `img.jpeg` in the same folder

### Via Admin Interface

1. Click "Manage Database" on homepage
2. Fill in user details (name, Aadhar, phone)
3. Upload a photo
4. Click "Add to Database"

**Note**: The admin interface shows instructions for manual file creation since this is a static application.

## File Storage Approach

**Current**: Filesystem (files in `userdata/` folder with JSON metadata)
- Pros: Simple, no database needed, works great for demos
- Cons: Limited scalability

**For Production** (future):
- Cloud Storage (AWS S3, Firebase, etc.)
- Database (PostgreSQL, MongoDB, etc.)
- Backend API for CRUD operations

## Setup

1. Open `index.html` in a web browser
2. Ensure camera permissions are granted
3. That's it! No server needed for demo

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript
- **Face Recognition**: face-api.js
- **Design**: Glassmorphism UI
- **Storage**: Filesystem with JSON metadata

## Security Notes

- This is a demo/prototype
- For production, implement:
  - Server-side validation
  - Encrypted storage
  - Rate limiting
  - Authentication for admin panel
