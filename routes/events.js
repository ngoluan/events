// routes/events.js
const express = require('express');
const router = express.Router();
const eventService = require('../services/eventService');
const pdfService = require('../services/pdfService');
const googleCalendarService = require('../services/googleCalendarService');

// Get all events
router.get('/', (req, res) => {
  const events = eventService.loadEvents();
  res.json(events);
});

// Add a new event
router.post('/', (req, res) => {
  const events = eventService.loadEvents();
  const newEvent = req.body;
  newEvent.id = events.length > 0 ? events[events.length - 1].id + 1 : 1;
  events.push(newEvent);
  eventService.saveEvents(events);
  res.json(newEvent);
});

// Update an event
router.put('/:id', (req, res) => {
  const events = eventService.loadEvents();
  const eventId = parseInt(req.params.id);
  const index = events.findIndex((e) => e.id === eventId);
  if (index !== -1) {
    events[index] = req.body;
    eventService.saveEvents(events);
    res.json(events[index]);
  } else {
    res.status(404).send('Event not found');
  }
});

// Delete an event
router.delete('/:id', (req, res) => {
  const events = eventService.loadEvents();
  const eventId = parseInt(req.params.id);
  const index = events.findIndex((e) => e.id === eventId);
  if (index !== -1) {
    events.splice(index, 1);
    eventService.saveEvents(events);
    res.sendStatus(200);
  } else {
    res.status(404).send('Event not found');
  }
});

// Generate a contract for an event
router.post('/:id/contract', async (req, res) => {
  const events = eventService.loadEvents();
  const eventId = parseInt(req.params.id);
  const event = events.find((e) => e.id === eventId);
  if (event) {
    try {
      const { fileName, filePath } = await pdfService.generateContract(event);
      res.json({ fileName, filePath });
    } catch (error) {
      console.error('Error generating contract:', error);
      res.status(500).send('Error generating contract');
    }
  } else {
    res.status(404).send('Event not found');
  }
});
router.get('/getEventsContacts', (req, res) => {
  const events = eventService.loadEvents();
  res.json(events);
});

// List Google Calendar events
router.get('/calendar/events', async (req, res) => {
  try {
    const events = await googleCalendarService.listEvents();
    res.json(events);
  } catch (error) {
    console.error('Error listing calendar events:', error);
    res.status(500).send('Error listing calendar events');
  }
});

// Add event to Google Calendar
router.post('/calendar/events', async (req, res) => {
  const eventData = req.body;
  try {
    const event = await googleCalendarService.addEvent(eventData);
    res.json(event);
  } catch (error) {
    console.error('Error adding event to calendar:', error);
    res.status(500).send('Error adding event to calendar');
  }
});

module.exports = router;
