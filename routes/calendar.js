//--- File: /home/luan_ngo/web/events/routes/calendar.js ---
const express = require('express');
const router = express.Router();
const googleCalendarService = require('../services/googleCalendarService');

module.exports = (googleAuth) => {
  // Initialize GoogleCalendarService with googleAuth
  const calendarService = new googleCalendarService(googleAuth);

  router.get('/getEventCalendar', async (req, res) => {
    try {
      const events = await calendarService.listEvents();
      res.json(events);
    } catch (error) {
      console.error('Error fetching events from Google Calendar:', error);
      res.status(500).send('Error fetching events from Google Calendar');
    }
  });

  router.post('/calendar/events', async (req, res) => {
    const eventData = req.body;
    try {
      const event = await calendarService.addEvent(eventData);
      res.json(event);
    } catch (error) {
      console.error('Error adding event to calendar:', error);
      res.status(500).send('Error adding event to calendar');
    }
  });

  return router;
};
