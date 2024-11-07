const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');

module.exports = (googleAuth) => {
    const gmail = new gmailService(googleAuth);
    router.post('/archiveEmail/:id', async (req, res) => {
        try {
            const messageId = req.params.id;
            await gmail.archiveEmail(messageId);
            res.json({ success: true });
        } catch (error) {
            console.error('Error archiving email:', error);
            res.status(500).json({
                error: 'Error archiving email',
                details: error.message
            });
        }
    });

    // In your Express routes (gmail.js)
    router.get('/readGmail', async (req, res) => {
        try {
            const type = req.query.type || 'all';
            const email = req.query.email;
            const forceRefresh = req.query.forceRefresh === 'true';

            let emails;
            if (forceRefresh) {
                emails = await gmail.forceFullRefresh();
            } else if (type === 'contact' && email) {
                emails = await gmail.getEmailsForContact(email);
            } else {
                emails = await gmail.getAllEmails();
            }

            // filter for labels inbox
            emails = emails.filter(email => email.labels.includes('INBOX'));

            res.json(emails);
        } catch (error) {
            console.error('Error reading Gmail:', error);
            res.status(500).json({
                error: 'Error reading Gmail',
                details: error.message,
            });
        }
    });

    router.get('/messages/:id', async (req, res) => {
        try {
            const message = await gmail.getMessage(req.params.id);
            const content = await gmail.parseEmailContent(message);
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

    async function checkForReplies(emails, cachedEmailMap) {
        // Group emails by threadId for more efficient processing
        const threadGroups = new Map();
        emails.forEach(email => {
            if (!email.labels.includes('SENT')) { // Double check to ensure no sent emails
                if (!threadGroups.has(email.threadId)) {
                    threadGroups.set(email.threadId, []);
                }
                threadGroups.set(email.threadId, [...threadGroups.get(email.threadId), email]);
            }
        });

        for (const [threadId, threadEmails] of threadGroups) {
            try {
                const threadMessages = await gmail.getThreadMessages(threadId);

                // Only get sent messages for comparison
                const sentMessages = threadMessages.filter(msg => msg.labelIds.includes('SENT'));

                // For each inbox message in the thread
                threadEmails.forEach(inboxEmail => {
                    const replied = sentMessages.some(sentMsg =>
                        parseInt(sentMsg.internalDate) > parseInt(inboxEmail.internalDate)
                    );

                    if (cachedEmailMap[inboxEmail.id]) {
                        cachedEmailMap[inboxEmail.id].replied = replied;
                    }
                });
            } catch (err) {
                console.error(`Error checking replies for thread ${threadId}:`, err);
            }
        }
    }

    return router;
};