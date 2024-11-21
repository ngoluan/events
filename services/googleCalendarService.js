// services/googleCalendarService.js
const { google } = require('googleapis');
const path = require('path');

class GoogleCalendarService {
  constructor(auth) {
    this.auth = auth; // This should be an instance of GoogleAuth
  }

  async listEvents() {
    // Obtain the OAuth2 client
    const authClient = await this.auth.getOAuth2Client();
    const calendar = google.calendar({ version: 'v3', auth: authClient });
    
    // Calculate date from 2 months ago
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: twoMonthsAgo.toISOString(),
      maxResults: 2500,
      singleEvents: true,
      orderBy: 'startTime',
    });
    return res.data.items || [];
  }
  async addEvent(eventData) {
    // Obtain the OAuth2 client
    const authClient = await this.auth.getOAuth2Client();
    const calendar = google.calendar({ version: 'v3', auth: authClient });
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

module.exports = GoogleCalendarService;
