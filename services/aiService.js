const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const backgroundService = require('./BackgroundService');
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

class AIService {
  constructor() {
    this.provider = {
      name: 'OpenAI',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini-2024-07-18',
    };

    this.dataDir = path.join(__dirname, '..', 'data');
    this.conversationsPath = path.join(this.dataDir, 'conversations.json');

    // Create data directory if it doesn't exist
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Keep a simple message history for the current session
    this.messageHistory = [];
    this.currentConversationId = null;

    // Load existing conversations
    this.loadConversations();
  }

  loadConversations() {
    try {
      if (fs.existsSync(this.conversationsPath)) {
        const conversations = JSON.parse(fs.readFileSync(this.conversationsPath, 'utf8'));
        // Load the last conversation's messages into memory if it exists
        if (conversations.length > 0) {
          const lastConversation = conversations[conversations.length - 1];
          this.messageHistory = lastConversation.messages;
          this.currentConversationId = lastConversation.id;
        }
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
      this.messageHistory = [];
    }
  }

  saveConversations() {
    try {
      // Process message history to stringify any object content
      const processedHistory = this.messageHistory.map(message => {
        const processedMessage = { ...message };
        if (typeof processedMessage.content === 'object' && processedMessage.content !== null) {
          processedMessage.content = JSON.stringify(processedMessage.content);
        }
        return processedMessage;
      });

      fs.writeFileSync(this.conversationsPath, JSON.stringify(processedHistory, null, 2));
    } catch (error) {
      console.error('Error saving conversations:', error);
    }
  }


  async generateResponse(messages, options = {}) {
    try {
      const {
        includeBackground = false,
        maxTokens = undefined,
        resetHistory = false,
        includeHistory = true,
        schema = null,
        schemaName = null,
      } = options;

      // Start a new conversation if requested or none exists
      if (resetHistory || !this.currentConversationId) {
        this.messageHistory = [];
        this.currentConversationId = Date.now().toString();
      }

      // Build message array
      let contextualizedMessages = [];

      // Add conversation history if needed
      if (includeHistory && !resetHistory && this.messageHistory.length > 0) {
        contextualizedMessages.push(...this.messageHistory); 
      }

      // Add new messages
      contextualizedMessages.push(...messages);

      // Add background information if needed
      if (includeBackground) {
        const { backgroundInfo } = backgroundService.getBackground();
        if (backgroundInfo) {
          const systemMessage = {
            role: 'system',
            content: `Use this venue information as context for your response:\n\n${backgroundInfo}\n\n${messages.find(m => m.role === 'system')?.content || ''}`
          };

          const systemIndex = contextualizedMessages.findIndex(m => m.role === 'system');
          if (systemIndex >= 0) {
            contextualizedMessages[systemIndex] = systemMessage;
          } else {
            contextualizedMessages.unshift(systemMessage);
          }
        }
      }

      const openai = new OpenAI({ apiKey: this.provider.apiKey });
      let response;
      let parsedData;

      if (schema) {
        const result = await openai.beta.chat.completions.parse({
          model: this.provider.model,
          messages: contextualizedMessages,
          response_format: zodResponseFormat(schema, schemaName),
          ...(maxTokens && { max_tokens: maxTokens })
        });
        parsedData = result.choices[0].message.parsed;
        response = parsedData
      } else {
        contextualizedMessages = contextualizedMessages.map(message => {
          if (typeof message.content === 'object' && message.content !== null) {
            message.content = JSON.stringify(message.content);
          }
          return message;
        });

        const result = await openai.chat.completions.create({
          model: this.provider.model,
          messages: contextualizedMessages,
          ...(maxTokens && { max_tokens: maxTokens })
        });
        response = result.choices[0].message.content;
      }

      // Add timestamp to messages
      const timestamp = new Date().toISOString();
      const messagesWithTimestamp = messages.map(msg => ({
        ...msg,
        timestamp
      }));
      const responseWithTimestamp = {
        role: 'assistant',
        content: response,
        timestamp
      };

      this.messageHistory.push(...messagesWithTimestamp);
      this.messageHistory.push(responseWithTimestamp);

      // Keep history manageable
      if (this.messageHistory.length > 50) {
        this.messageHistory = this.messageHistory.slice(-50);
      }

      // Save to file
      this.saveConversations();

      return {
        response,
        parsedData: schema ? parsedData : undefined,
        historyIncluded: includeHistory && !resetHistory,
        historyReset: resetHistory,
        messageCount: this.messageHistory.length
      };

    } catch (error) {
      console.error('Error generating AI response:', error);
      throw error;
    }
  }

  clearHistory() {
    this.messageHistory = [];
    this.currentConversationId = Date.now().toString();
    this.saveConversations();
  }

  getMessageHistory() {
    return this.messageHistory;
  }
}

module.exports = new AIService();