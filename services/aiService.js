const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const backgroundService = require('./BackgroundService');
const { zodResponseFormat } = require('openai/helpers/zod');
const Groq = require("groq-sdk");
const { GoogleGenerativeAI } = require('@google/generative-ai');
class AIService {
  constructor() {
    // Initialize AI providers
    this.providers = {
      openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      groq: new Groq({ apiKey: process.env.GROQ_API_KEY }),
      google: new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
    };
    // Default configuration
    this.currentProvider = {
      name: 'openai',
      model: 'gpt-4o-mini-2024-07-18'
    };
    // Provider-specific model mappings
    this.modelMappings = {
      openai: {
        default: 'gpt-4o-mini-2024-07-18',
        alternative: 'gpt-4'
      },
      groq: {
        default: 'mixtral-8x7b-32768',
        alternative: 'llama2-70b-4096'
      },
      google: {
        default: 'gemini-1.5-flash',
        alternative: 'gemini-1.5-pro'
      }
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

  setProvider(providerName, modelName = null) {
    if (!this.providers[providerName]) {
      throw new Error(`Unsupported provider: ${providerName}`);
    }

    this.currentProvider.name = providerName;
    this.currentProvider.model = modelName || this.modelMappings[providerName].default;
  }
  loadConversations() {
    try {
      if (fs.existsSync(this.conversationsPath)) {
        const conversations = JSON.parse(fs.readFileSync(this.conversationsPath, 'utf8'));
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
        provider = this.currentProvider.name,
        model = this.currentProvider.model
      } = options;

      if (resetHistory || !this.currentConversationId) {
        this.messageHistory = [];
        this.currentConversationId = Date.now().toString();
      }

      let contextualizedMessages = [];

      if (includeHistory && !resetHistory && this.messageHistory.length > 0) {
        contextualizedMessages.push(...this.messageHistory);
      }

      contextualizedMessages.push(...messages);

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

      let response;
      let parsedData;

      // Process messages based on provider
      switch (provider) {
        case 'openai':
          if (schema) {
            const result = await this.providers.openai.beta.chat.completions.parse({
              model,
              messages: contextualizedMessages,
              response_format: zodResponseFormat(schema, schemaName),
              ...(maxTokens && { max_tokens: maxTokens })
            });
            parsedData = result.choices[0].message.parsed;
            response = parsedData;
          } else {
            const result = await this.providers.openai.chat.completions.create({
              model,
              messages: contextualizedMessages,
              ...(maxTokens && { max_tokens: maxTokens })
            });
            response = result.choices[0].message.content;
          }
          break;

        case 'groq':
          const groqResult = await this.providers.groq.chat.completions.create({
            model,
            messages: contextualizedMessages,
            ...(maxTokens && { max_tokens: maxTokens })
          });
          response = groqResult.choices[0].message.content;
          break;

        case 'google':
          const geminiModel = this.providers.google.getGenerativeModel({ model });
          const contents = contextualizedMessages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : (msg.role === 'system' ? 'user' : msg.role),
            parts: [{ text: msg.content }]
          }));
          const geminiResult = await geminiModel.generateContent({ contents });
          response = geminiResult.response.text();
          break;

        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }

      const timestamp = new Date().toISOString();
      const messagesWithTimestamp = messages.map(msg => ({
        ...msg,
        timestamp
      }));
      const responseWithTimestamp = {
        role: 'assistant',
        content: response,
        timestamp,
        provider,
        model
      };

      this.messageHistory.push(...messagesWithTimestamp);
      this.messageHistory.push(responseWithTimestamp);

      if (this.messageHistory.length > 50) {
        this.messageHistory = this.messageHistory.slice(-50);
      }

      this.saveConversations();

      return {
        response,
        parsedData: schema ? parsedData : undefined,
        historyIncluded: includeHistory && !resetHistory,
        historyReset: resetHistory,
        messageCount: this.messageHistory.length,
        provider,
        model
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