//--- File: /home/luan_ngo/web/events/routes/gmail.js ---
const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');

module.exports = (googleAuth) => {
  // Initialize GmailService with googleAuth
  const gmail = new gmailService(googleAuth);

  router.get('/readGmail', async (req, res) => {
    try {
      const email = req.query.email || 'all';
      const showCount = parseInt(req.query.showCount) || 25;

      console.log(`Reading Gmail for ${email}, count: ${showCount}`);
      const messages = await gmail.listMessages(email, null, showCount);
     // Dynamically import p-limit
     const pLimitModule = await import('p-limit');
     const pLimit = pLimitModule.default; // p-limit exports as default

     const limit = pLimit(10); // Limit concurrency to 10


      // Map messages to promises with concurrency control
      const fullMessagesPromises = messages.map((message) => 
        limit(async () => {
          try {
            const fullMessage = await gmail.getMessage(message.id);
            const content = await gmail.parseEmailContent(fullMessage);
            return {
              id: message.id,
              from: fullMessage.payload.headers.find(h => h.name === 'From')?.value || '',
              to: fullMessage.payload.headers.find(h => h.name === 'To')?.value || '',
              subject: fullMessage.payload.headers.find(h => h.name === 'Subject')?.value || '',
              timestamp: fullMessage.payload.headers.find(h => h.name === 'Date')?.value || '',
              text: content,
              labels: fullMessage.labelIds || []
            };
          } catch (err) {
            console.error(`Error processing message ID ${message.id}:`, err);
            return null; // Optionally handle individual message errors
          }
        })
      );

      // Await all promises
      const fullMessages = await Promise.all(fullMessagesPromises);

      // Filter out any null results due to errors
      const validMessages = fullMessages.filter(msg => msg !== null);

      res.json(validMessages);
    } catch (error) {
      console.error('Error reading Gmail:', error);
      res.status(500).json({ 
        error: 'Error reading Gmail',
        details: error.message
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

  return router;
};
