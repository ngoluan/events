const express = require('express');
const router = express.Router();
const GoogleAuth = require('../services/GoogleAuth');
const cors = require('cors');

const googleAuth = new GoogleAuth();

// Add CORS middleware for the oauth routes
router.use(cors({
    origin: process.env.FRONTEND_URL || 'https://events.luanngo.ca',
    credentials: true
}));

// Initialize Google OAuth
router.get('/google', (req, res) => {
    try {
        // Generate the auth URL
        const authUrl = googleAuth.generateAuthUrl();
        // Directly redirect to Google's OAuth page
        res.json({ authUrl });
    } catch (error) {
        console.error('Error generating auth URL:', error);
        // Redirect to frontend with error
        res.redirect(`${process.env.FRONTEND_URL || 'https://events.luanngo.ca'}?oauth=error`);
    }
});

// Handle OAuth callback
router.get('/google/callback', async (req, res) => {
    const code = req.query.code;
    const frontendUrl = process.env.FRONTEND_URL || 'https://events.luanngo.ca';
    
    if (!code) {
        return res.redirect(`${frontendUrl}?oauth=error&message=No_authorization_code`);
    }

    try {
        const result = await googleAuth.handleCallback(code);
        if (result.success) {
            // Store email in session
            req.session.userEmail = result.email;
            
            // Redirect to frontend
            res.redirect(`${frontendUrl}?oauth=success`);
        } else {
            throw new Error(result.error || 'Authentication failed');
        }
    } catch (error) {
        console.error('Error handling OAuth callback:', error);
        res.redirect(`${frontendUrl}?oauth=error&message=${encodeURIComponent(error.message)}`);
    }
});

module.exports = router;