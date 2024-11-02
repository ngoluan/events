// services/aiService.js
const OpenAI = require('openai');
const axios = require('axios');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const backgroundService = require('./BackgroundService');


// Path to save conversation history
const conversationsPath = path.join(__dirname, '..', 'data', 'conversations.json');

class AIService {
  constructor() {
    // Initialize supported AI providers
    this.providers = {
      openai: {
        name: 'OpenAI',
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4o-mini-2024-07-18',
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

  async generateResponse(messages, options = {}) {
    try {
      // Only include background if specifically requested
      if (options.includeBackground) {
        // Get background info
        const { backgroundInfo } = backgroundService.getBackground();

        if (backgroundInfo) {
          // Find or create system message
          const systemMessageIndex = messages.findIndex(m => m.role === 'system');
          const systemMessage = {
            role: 'system',
            content: `Use this venue information as context for your response:\n\n${backgroundInfo}\n\n${systemMessageIndex >= 0 ? messages[systemMessageIndex].content : ''}`
          };

          if (systemMessageIndex >= 0) {
            // Update existing system message
            messages[systemMessageIndex] = systemMessage;
          } else {
            // Add system message at the start
            messages.unshift(systemMessage);
          }
        }
      }

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
        // ... existing otherai code ...
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
