// services/aiService.js
const OpenAI = require('openai');
const axios = require('axios');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');

// Path to save conversation history
const conversationsPath = path.join(__dirname, '..', 'data', 'conversations.json');

class AIService {
  constructor() {
    // Initialize supported AI providers
    this.providers = {
      openai: {
        name: 'OpenAI',
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-3.5-turbo',
      },
      // Placeholder for other AI providers
      // Example:
      // otherai: {
      //   name: 'OtherAI',
      //   apiKey: process.env.OTHERAI_API_KEY,
      //   endpoint: 'https://api.otherai.com/v1/chat',
      // },
    };

    // Set default provider
    this.currentProvider = 'openai';
  }

  setProvider(providerName) {
    if (this.providers[providerName]) {
      this.currentProvider = providerName;
    } else {
      throw new Error(`AI provider ${providerName} is not supported.`);
    }
  }

  loadConversationHistory() {
    if (fs.existsSync(conversationsPath)) {
      const data = fs.readFileSync(conversationsPath, 'utf8');
      return JSON.parse(data);
    } else {
      return [];
    }
  }

  saveConversationHistory(history) {
    fs.writeFileSync(conversationsPath, JSON.stringify(history, null, 2));
  }

  async generateResponse(messages) {
    try {
      const provider = this.providers[this.currentProvider];
      if (this.currentProvider === 'openai') {
        const openai = new OpenAI({
          apiKey: provider.apiKey,
        });

        const response = await openai.chat.completions.create({
          model: provider.model,
          messages: messages,
        });

        return response.choices[0].message.content;

      } else if (this.currentProvider === 'otherai') {
        // Hypothetical implementation for another AI provider
        const response = await axios.post(provider.endpoint, {
          apiKey: provider.apiKey,
          messages: messages,
        });
        return response.data.response;

      } else {
        throw new Error(`AI provider ${this.currentProvider} is not implemented.`);
      }
    } catch (error) {
      console.error('Error generating AI response:', error);
      throw error;
    }
  }
}

module.exports = new AIService();
