const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

class GmailService {
    constructor(auth) {
        this.auth = auth;
        this.cacheFilePath = path.join(__dirname, '..', 'data', 'emails.json');


    }
    saveEmailsToCache(emails) {
        fs.writeFileSync(this.cacheFilePath, JSON.stringify(emails, null, 2), 'utf8');
      }

      loadEmailsFromCache() {
        if (fs.existsSync(this.cacheFilePath)) {
          const data = fs.readFileSync(this.cacheFilePath, 'utf8');
          return JSON.parse(data);
        }
        return [];
      }
    async listMessages(userEmail, gmailEmail, showCount, labelIds = []) {
        try {
            const authClient = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth: authClient });

            const res = await gmail.users.messages.list({
                userId: 'me',
                maxResults: showCount,
                q: gmailEmail ? `to:${gmailEmail}` : '',
                labelIds: labelIds.length > 0 ? labelIds : undefined,
            });
            return res.data.messages || [];
        } catch (error) {
            console.error('Error listing messages:', error);
            throw error;
        }
    }
    async getMessage(messageId) {
        try {
            const auth = await this.auth.getOAuth2Client();
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
    async getThreadMessages(threadId) {
        try {
            const authClient = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth: authClient });
            const res = await gmail.users.threads.get({
                userId: 'me',
                id: threadId,
                format: 'full',
            });
            return res.data.messages || [];
        } catch (error) {
            console.error('Error fetching thread messages:', error);
            throw error;
        }
    }
}

// Export an instance of the service
module.exports = GmailService;