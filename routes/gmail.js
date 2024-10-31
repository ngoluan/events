const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');

module.exports = (googleAuth) => {
    const gmail = new gmailService(googleAuth);

    router.get('/readGmail', async (req, res) => {
        try {
            const emailQuery = req.query.email || 'all';
            const showCount = parseInt(req.query.showCount) || 25;
            const labelIds = ['INBOX', 'SENT'];

            console.log(`Reading Gmail for ${emailQuery}, count: ${showCount}`);

            let cachedEmails = gmail.loadEmailsFromCache();
            let cachedEmailMap = {};
            cachedEmails.forEach(email => {
                cachedEmailMap[email.id] = email;
            });

            const messages = await gmail.listMessages(emailQuery, null, showCount, labelIds);
            let allEmails = [];
            let emailsToCheckForReplies = [];

            const asyncLib = require('async');
            asyncLib.mapLimit(
                messages,
                10,
                async (message) => {
                    try {
                        if (cachedEmailMap[message.id]) {
                            const emailData = cachedEmailMap[message.id];
                            allEmails.push(emailData);
                            return emailData;
                        }

                        const fullMessage = await gmail.getMessage(message.id);
                        const content = await gmail.parseEmailContent(fullMessage);

                        const emailData = {
                            id: message.id,
                            threadId: message.threadId,
                            from: fullMessage.payload.headers.find((h) => h.name === 'From')?.value || '',
                            to: fullMessage.payload.headers.find((h) => h.name === 'To')?.value || '',
                            subject: fullMessage.payload.headers.find((h) => h.name === 'Subject')?.value || '',
                            timestamp: fullMessage.payload.headers.find((h) => h.name === 'Date')?.value || '',
                            internalDate: fullMessage.internalDate,
                            text: content,
                            labels: fullMessage.labelIds || [],
                        };
                        console.log(`Fetching message ID ${message.id}`);

                        cachedEmailMap[message.id] = emailData;
                        allEmails.push(emailData);

                        // Only add to emailsToCheckForReplies if it's not a sent email
                        if (!emailData.labels.includes('SENT')) {
                            emailsToCheckForReplies.push(emailData);
                        } else {
                            // For sent emails, explicitly set replied to null or false
                            emailData.replied = null;
                        }

                        return emailData;
                    } catch (err) {
                        console.error(`Error processing message ID ${message.id}:`, err);
                        return null;
                    }
                },
                async (err, fullMessages) => {
                    if (err) {
                        console.error('Error processing messages:', err);
                        return res.status(500).json({
                            error: 'Error processing messages',
                            details: err.message,
                        });
                    }

                    const validMessages = fullMessages.filter((msg) => msg !== null);

                    // Only check for replies if there are emails to check
                    if (emailsToCheckForReplies.length > 0) {
                        await checkForReplies(emailsToCheckForReplies, cachedEmailMap);
                    }

                    const updatedEmails = Object.values(cachedEmailMap);
                    gmail.saveEmailsToCache(updatedEmails);

                    res.json(updatedEmails);
                }
            );
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