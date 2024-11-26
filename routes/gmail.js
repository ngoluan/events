const express = require('express');
const router = express.Router();

module.exports = (googleAuth, gmailService) => {

    router.post('/archiveEmail/:id', async (req, res) => {
        try {
            const messageId = req.params.id;
            await gmailService.archiveEmail(messageId);
            res.json({ success: true });
        } catch (error) {
            console.error('Error archiving email:', error);
            res.status(500).json({
                error: 'Error archiving email',
                details: error.message
            });
        }
    });
    router.post('/sendEmail', async (req, res) => {
        try {
            const { html, to, subject, replyToMessageId, source } = req.body;

            if (!html || !to || !subject) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    details: 'html, to, and subject are required'
                });
            }

            const result = await gmailService.sendEmail(to, subject, html, {
                replyToMessageId,
                source
            });

            res.json({
                success: true,
                messageId: result.messageId,
                threadId: result.threadId,
                isReply: result.isReply
            });
        } catch (error) {
            console.error('Error in send email route:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    router.get('/readGmail', async (req, res) => {
        try {
            const type = req.query.type || 'all';
            const email = req.query.email;
            const forceRefresh = req.query.forceRefresh === 'true';
            const count = req.query.count || 25;

            let emails;
            if (type === 'interac') {
                // Handle Interac e-Transfer emails specifically
                emails = await gmailService.getAllEmails(count, false, forceRefresh, "in:inbox-deposits");
                emails = emails.filter(email => {
                    const subject = email.subject?.toLowerCase() || '';
                    return subject.includes('interac');
                });
            } else if (type === 'contact' && email) {
                emails = await gmailService.getEmailsForContact(email);
            } else {
                emails = await gmailService.getAllEmails(50, false, forceRefresh);
            }

            // Apply inbox filter except for Interac emails
            if (type !== 'interac') {
                emails = emails.filter(email => email.labels.includes('INBOX'));
            }

            res.json(emails);
        } catch (error) {
            console.error('Error reading Gmail:', error);
            res.status(500).json({
                error: 'Error reading Gmail',
                details: error.message,
            });
        }
    });
    router.post('/forwardEmail', async (req, res) => {
        try {
            const { messageId, to } = req.body;
            const message = await gmailService.getMessage(messageId);

            // Forward the email
            await gmailService.sendEmail(
                to,
                `Fwd: ${message.payload.headers.find(h => h.name === 'Subject')?.value}`,
                message.parsedContent.html || message.parsedContent.text
            );

            res.json({ success: true });
        } catch (error) {
            console.error('Error forwarding email:', error);
            res.status(500).json({
                error: 'Error forwarding email',
                details: error.message
            });
        }
    });

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
                const threadMessages = await gmailService.getThreadMessages(threadId);

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