// routes/gmail.js
const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');
const aiService = require('../services/aiService');
const eventService = require('../services/eventService');

// Endpoint to list messages
router.get('/messages', async (req, res) => {
  try {
    const messages = await gmailService.listMessages();
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Gmail service error' });
  }
});

// Read a specific email and parse event information
router.get('/messages/:id/parse', async (req, res) => {
  const messageId = req.params.id;
  try {
    const message = await gmailService.getMessage(messageId);

    // Extract the email content
    const emailContent = await gmailService.parseEmailContent(message);

    // Send the email content to AI service to parse event information
    const messages = [
      { role: 'system', content: 'You are an assistant that extracts event information from emails and responds in JSON format.' },
      { role: 'user', content: emailContent },
    ];
    const aiResponse = await aiService.generateResponse(messages);

    // Parse the AI response to get event data
    let eventData;
    try {
      eventData = JSON.parse(aiResponse);
    } catch (error) {
      console.error('Error parsing AI response:', error);
      return res.status(500).send('Error parsing AI response');
    }

    // Save the event data to events database
    const events = eventService.loadEvents();
    eventData.id = events.length > 0 ? events[events.length - 1].id + 1 : 1;
    events.push(eventData);
    eventService.saveEvents(events);

    res.json(eventData);

  } catch (error) {
    console.error('Error parsing email:', error);
    res.status(500).json({ error: 'Error parsing email' });
  }
});

// Endpoint to draft email responses
router.post('/messages/:id/draft', async (req, res) => {
  const messageId = req.params.id;
  const { responseTemplate } = req.body; // Template or instruction for AI
  try {
    const message = await gmailService.getMessage(messageId);
    const emailContent = await gmailService.parseEmailContent(message);

    // Send the email content and template to AI service to draft a response
    const messages = [
      { role: 'system', content: 'You are an assistant that drafts email responses based on templates and previous emails.' },
      { role: 'user', content: `Email Content: ${emailContent}\nTemplate: ${responseTemplate}` },
    ];
    const aiResponse = await aiService.generateResponse(messages);

    res.json({ draft: aiResponse });
  } catch (error) {
    console.error('Error drafting email response:', error);
    res.status(500).json({ error: 'Error drafting email response' });
  }
});
// routes/gmail.js

router.get('/readGmail', async (req, res) => {
  try {
    const email = req.query.email;
    const showCount = parseInt(req.query.showCount) || 25;

    const messages = await gmailService.listMessages(email, showCount);
    res.json(messages);
  } catch (error) {
    console.error('Error reading Gmail:', error);
    res.status(500).json({ error: 'Error reading Gmail' });
  }
});

module.exports = router;


module.exports = router;
