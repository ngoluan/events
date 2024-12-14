// routes/ai.js
const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');

// Endpoint to handle AI chat
router.post('/chat', async (req, res) => {
  const { message, provider } = req.body;
  try {
    // Set AI provider if specified
    if (provider) {
      aiService.setProvider(provider);
    }

    // Send the conversation history to the AI service
    const aiResponse = await aiService.generateResponse([
      {
        role: 'user',
        content: message
      }
    ]
    );

    res.json({ response: aiResponse.response });
  } catch (error) {
    res.status(500).json({ error: 'AI service error' });
  }
});
router.get('/conversations', (req, res) => {
  try {
    const conversations = aiService.loadConversations();
    res.json(conversations || []); // Ensure we always send an array
  } catch (error) {
    console.error('Error getting conversation history:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});
router.post('/analyzeEventUpdate', async (req, res) => {
  try {
    const { eventDetails, emailContent } = req.body;

    const prompt = `
          Read only the most recent email in the email chain. 

          Current Event Details:
          ${JSON.stringify(eventDetails, null, 2)}
          
          New Email Content:
          ${emailContent}
          
          Provide a concise but summary of what should be added to the event notes.
          Focus on any changes to: attendance, catering preferences, drink selections, setup requests, 
          timing details, or special accommodations. Only respond with the organizers requets, no introduction. 
      `;

    const { response } = await aiService.generateResponse([

      {
        role: 'user',
        content: prompt
      }
    ], {
      includeBackground: true,
      resetHistory: true
    });

    res.json({
      success: true,
      summary: response
    });

  } catch (error) {
    console.error('Error analyzing event update:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Endpoint to reset conversation history
router.get('/resetHistory', (req, res) => {
  aiService.resetHistory([]);
  res.json({ message: 'Conversation history reset' });
});

module.exports = router;
