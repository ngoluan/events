const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');

// Handle email reading
router.get('/readGmail', async (req, res) => {
    try {
        const email = req.query.email || 'all';
        const showCount = parseInt(req.query.showCount) || 25;

        console.log(`Reading Gmail for ${email}, count: ${showCount}`);
        const messages = await gmailService.listMessages(email);
        
        // Map through messages to get full content
        const fullMessages = await Promise.all(
            messages.map(async (message) => {
                const fullMessage = await gmailService.getMessage(message.id);
                const content = await gmailService.parseEmailContent(fullMessage);
                return {
                    id: message.id,
                    from: fullMessage.payload.headers.find(h => h.name === 'From')?.value || '',
                    to: fullMessage.payload.headers.find(h => h.name === 'To')?.value || '',
                    subject: fullMessage.payload.headers.find(h => h.name === 'Subject')?.value || '',
                    timestamp: fullMessage.payload.headers.find(h => h.name === 'Date')?.value || '',
                    text: content,
                    labels: fullMessage.labelIds || []
                };
            })
        );

        res.json(fullMessages);
    } catch (error) {
        console.error('Error reading Gmail:', error);
        res.status(500).json({ 
            error: 'Error reading Gmail',
            details: error.message
        });
    }
});

// Handle single message retrieval
router.get('/messages/:id', async (req, res) => {
    try {
        const message = await gmailService.getMessage(req.params.id);
        const content = await gmailService.parseEmailContent(message);
        res.json({
            id: message.id,
            from: message.payload.headers.find(h => h.name === 'From')?.value || '',
            to: message.payload.headers.find(h => h.name === 'To')?.value || '',
            subject: message.payload.headers.find(h => h.name === 'Subject')?.value || '',
            timestamp: message.payload.headers.find(h => h.name === 'Date')?.value || '',
            text: content,
            labels: message.labelIds || []
        });
    } catch (error) {
        console.error('Error retrieving message:', error);
        res.status(500).json({ 
            error: 'Error retrieving message',
            details: error.message 
        });
    }
});

module.exports = router;