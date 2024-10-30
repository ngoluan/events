// services/googleCalendarService.js
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class GoogleCalendarService {
  constructor() {
    this.credentialsPath = path.join(__dirname, '../credentials.json');
    this.tokenPath = path.join(__dirname, '../token.json');
    this.SCOPES = ['https://www.googleapis.com/auth/calendar'];

    this.auth = null;
  }

  authorize() {
    const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    if (fs.existsSync(this.tokenPath)) {
      const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
      oAuth2Client.setCredentials(token);
      this.auth = oAuth2Client;
    } else {
      throw new Error('Token not found. Please generate a token.');
    }
  }

  async listEvents() {
    if (!this.auth) {
      this.authorize();
    }
    const calendar = google.calendar({ version: 'v3', auth: this.auth });
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });
    return res.data.items || [];
  }

  async addEvent(eventData) {
    if (!this.auth) {
      this.authorize();
    }
    const calendar = google.calendar({ version: 'v3', auth: this.auth });
    const event = {
      summary: `Event: ${eventData.name}`,
      location: eventData.location || '',
      description: eventData.notes || '',
      start: {
        dateTime: eventData.startTime,
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: eventData.endTime,
        timeZone: 'America/New_York',
      },
    };
    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });
    return res.data;
  }
}

module.exports = new GoogleCalendarService();
