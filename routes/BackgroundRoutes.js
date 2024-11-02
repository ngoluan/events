//--- File: /home/luan_ngo/web/events/routes/background.js ---

const express = require('express');
const router = express.Router();
const backgroundService = require('../services/BackgroundService');

// Get background info
router.get('/api/settings/background', (req, res) => {
    try {
        const data = backgroundService.getBackground();
        res.json(data);
    } catch (error) {
        console.error('Error retrieving background info:', error);
        res.status(500).json({
            error: 'Failed to retrieve background information',
            details: error.message
        });
    }
});

// Save background info
router.post('/api/settings/background', (req, res) => {
    try {
        if (!req.body || typeof req.body.backgroundInfo !== 'string') {
            return res.status(400).json({
                error: 'Invalid request body. Expected { backgroundInfo: string }',
                receivedBody: req.body
            });
        }

        const success = backgroundService.saveBackground(req.body.backgroundInfo);

        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to save background information' });
        }
    } catch (error) {
        console.error('Error saving background info:', error);
        res.status(500).json({
            error: 'Failed to save background information',
            details: error.message
        });
    }
});

module.exports = router;