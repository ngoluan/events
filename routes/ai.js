// routes/ai.js
const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');

// Endpoint to handle AI chat
router.post('/chat', async (req, res) => {
  const { messages, provider } = req.body;
  try {
    // Set AI provider if specified
    if (provider) {
      aiService.setProvider(provider);
    }

    // Load existing conversation history
    let conversationHistory = aiService.loadConversations();

    // Add new messages to conversation history
    conversationHistory.push(...messages);

    // Send the conversation history to the AI service
    const aiResponse = await aiService.generateResponse(conversationHistory);

    // Add AI's response to the conversation history
    conversationHistory.push({ role: 'assistant', content: aiResponse });

    // Save updated conversation history
    aiService.saveConversationHistory(conversationHistory);

    res.json({ response: aiResponse });
  } catch (error) {
    res.status(500).json({ error: 'AI service error' });
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
router.post('/reset', (req, res) => {
  aiService.saveConversationHistory([]);
  res.json({ message: 'Conversation history reset' });
});

module.exports = router;
