// routes/oauth.js

const express = require('express');
const router = express.Router();
const GoogleAuth = require('../services/GoogleAuth');

const googleAuth = new GoogleAuth();

// Initiate Google OAuth flow
router.get('/google', (req, res) => {
  const { selectedEmail, accountType } = req.query;
  const userEmail = req.session.userEmail; // Ensure user is authenticated

  if (!userEmail) {
    return res.status(401).send('User not authenticated');
  }

  try {
    const authUrl = googleAuth.generateAuthUrl(selectedEmail, userEmail, accountType);
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).send('Error generating auth URL');
  }
});

// Handle OAuth callback
router.get('/google/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;

  try {
    const result = await googleAuth.handleCallback(code, state);
    if (result.success) {
      res.redirect('/'); // Redirect to your desired route
    } else {
      res.status(500).send(`Authentication failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    res.status(500).send('Error handling OAuth callback');
  }
});

module.exports = router;
