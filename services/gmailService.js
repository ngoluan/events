// services/gmailService.js
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const GoogleAuth = require('./GoogleAuth');
class GmailService {
  constructor() {
    this.googleAuth = new GoogleAuth();
  }

  async listMessages(userEmail, gmailEmail, showCount) {
    try {
      const auth = await this.googleAuth.getOAuth2ClientForEmail(userEmail, gmailEmail);
      const gmail = google.gmail({ version: 'v1', auth });
      const res = await gmail.users.messages.list({
        userId: 'me',
        maxResults: showCount,
        q: `to:${gmailEmail}`,
      });
      return res.data.messages || [];
    } catch (error) {
      throw error;
    }
  }

  async getMessage(userEmail, gmailEmail, messageId) {
    try {
      const auth = await this.googleAuth.getOAuth2ClientForEmail(userEmail, gmailEmail);
      const gmail = google.gmail({ version: 'v1', auth });
      const res = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });
      return res.data;
    } catch (error) {
      throw error;
    }
  }

  async parseEmailContent(message) {
    // Extract the email content from the message payload
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

module.exports = new GmailService();
