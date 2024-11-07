//--- File: /home/luan_ngo/web/events/routes/oauth.js ---
const express = require('express');
const cors = require('cors');

module.exports = (googleAuth) => {
  const router = express.Router();

  router.use(cors({
    origin: process.env.GOOGLE_REDIRECT_URI || 'https://your-frontend-url.com',
    credentials: true
  }));

  router.get('/google', (req, res) => {
    try {
      const authUrl = googleAuth.generateAuthUrl();
      res.json({ authUrl });
    } catch (error) {
      console.error('Error generating auth URL:', error);
      res.redirect(`${process.env.GOOGLE_REDIRECT_URI || 'https://your-frontend-url.com'}?oauth=error`);
    }
  });

  router.get('/google/callback', async (req, res) => {
    const code = req.query.code;
    const frontendUrl = process.env.GOOGLE_REDIRECT_URI || 'https://your-frontend-url.com';

    if (!code) {
      return res.redirect(`${frontendUrl}?oauth=error&message=No_authorization_code`);
    }

    try {
      const result = await googleAuth.handleCallback(code);
      if (result.success) {
        req.session.userEmail = result.email;
        res.redirect(`https://events.luanngo.ca`);
      } else {
        throw new Error(result.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('Error handling OAuth callback:', error);
      res.redirect(`${frontendUrl}?oauth=error&message=${encodeURIComponent(error.message)}`);
    }
  });

  return router;
};
