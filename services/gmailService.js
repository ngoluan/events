const { google } = require('googleapis');
const GoogleAuth = require('./GoogleAuth');

class GmailService {
    constructor() {
        // Create new instance of GoogleAuth
        this.googleAuth = new GoogleAuth();
    }

    async listMessages(userEmail, gmailEmail, showCount) {
        try {
            const auth = await this.googleAuth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth });
            const res = await gmail.users.messages.list({
                userId: 'me',
                maxResults: showCount,
                q: gmailEmail ? `to:${gmailEmail}` : ''
            });
            return res.data.messages || [];
        } catch (error) {
            console.error('Error listing messages:', error);
            throw error;
        }
    }

    async getMessage(messageId) {
        try {
            const auth = await this.googleAuth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth });
            const res = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full'
            });
            return res.data;
        } catch (error) {
            console.error('Error getting message:', error);
            throw error;
        }
    }

    async parseEmailContent(message) {
        const payload = message.payload;
        let emailBody = '';
        
        if (payload.parts) {
            for (const part of payload.parts) {
                if (part.mimeType === 'text/plain') {
                    emailBody += Buffer.from(part.body.data, 'base64').toString('utf-8');
                }
            }
        } else if (payload.body && payload.body.data) {
            emailBody = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        }
        
        return emailBody;
    }
}

// Export an instance of the service
module.exports = new GmailService();