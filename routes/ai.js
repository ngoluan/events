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
    let conversationHistory = aiService.loadConversationHistory();

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

// Endpoint to reset conversation history
router.post('/reset', (req, res) => {
  aiService.saveConversationHistory([]);
  res.json({ message: 'Conversation history reset' });
});

module.exports = router;
