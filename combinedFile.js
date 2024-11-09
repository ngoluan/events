
//--- File: /home/luan_ngo/web/events/services/aiService.js ---
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

    
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    
    this.messageHistory = [];
    this.currentConversationId = null;

    
    this.loadConversations();
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

      
      if (this.messageHistory.length > 50) {
        this.messageHistory = this.messageHistory.slice(-50);
      }

      
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

//--- File: /home/luan_ngo/web/events/services/EmailProcessorServer.js ---
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const moment = require('moment-timezone');
const { z } = require('zod');
const aiService = require('./aiService');
const GoogleCalendarService = require('./googleCalendarService');
const backgroundService = require('./BackgroundService');
const { reset } = require('nodemon');

class EmailProcessorServer {
    constructor(googleAuth) {
        this.router = express.Router();
        this.router.use(express.json());
        this.router.use(express.urlencoded({ extended: true }));
        this.googleCalendarService = new GoogleCalendarService(googleAuth);

        try {
            const templatesPath = path.join(__dirname, '..', 'data', 'eventPrompts.json');
            this.templates = JSON.parse(fs.readFileSync(templatesPath, 'utf8'));
        } catch (error) {
            console.error('Error loading templates:', error);
            this.templates = {};
        }

        this.setupRoutes();
    }
    getRouter() {
        return this.router;
    }
    async checkAvailabilityAI(date, emailText) {
        try {
            const calendarEvents = await this.googleCalendarService.listEvents();

            const targetDate = moment(date).startOf('day');
            const relevantEvents = calendarEvents.filter(event => {
                const eventDate = moment(event.start.dateTime || event.start.date).startOf('day');
                return eventDate.isSame(targetDate);
            });

            const formattedEvents = relevantEvents.map(event => ({
                name: event.summary,
                startDate: moment(event.start.dateTime || event.start.date).format('HH:mm'),
                endDate: moment(event.end.dateTime || event.end.date).format('HH:mm'),
                room: event.location || 'Unspecified'
            }));

            const prompt = `
                Please analyze the availability for an event request based on the following:

                Current bookings for ${targetDate.format('YYYY-MM-DD')}:
                ${JSON.stringify(formattedEvents, null, 2)}

                Client Inquiry:
                ${emailText}

                You are a event venue coordinator. Draft a response to the client inquiry. If they dont specify a room, suggest the room most appropriate for their party size. If they are interested in booking, tell them if the venue is available 
                the day that they want. Provide information on services if venue is available.  Provide information on catering and drink packages if they ask.
                Be concise and semi formal. 
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

            return {response};

        } catch (error) {
            console.error('Error checking availability:', error);
            throw error;
        }
    }

    structureUnformattedResponse(response) {
        const lines = response.split('\n').filter(line => line.trim());
        const keyPoints = [];
        const actionItems = [];
        let summary = '';

        lines.forEach((line, index) => {
            if (index === 0) {
                summary = line;
            } else if (line.toLowerCase().includes('action') || line.includes('•')) {
                actionItems.push(line.replace('•', '').trim());
            } else if (line.startsWith('-') || line.startsWith('*')) {
                keyPoints.push(line.replace(/^[-*]/, '').trim());
            }
        });

        return {
            summary,
            keyPoints,
            actionItems,
            timeline: {
                requestDate: this.extractDate(response, 'request'),
                eventDate: this.extractDate(response, 'event'),
                deadlines: []
            }
        };
    }

    extractDate(text, type) {
        const datePattern = /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}-\d{2}-\d{2})/g;
        const dates = text.match(datePattern);
        if (dates && dates.length > 0) {
            return dates[0];
        }
        return '';
    }

    fixCommonDataIssues(data, zodError) {
        const fixedData = { ...data };

        zodError.errors.forEach(error => {
            const { path, code, message } = error;

            
            if (code === 'invalid_type' && message.includes('array')) {
                let value = data;
                for (let i = 0; i < path.length - 1; i++) {
                    value = value[path[i]];
                }
                const fieldValue = value[path[path.length - 1]];

                if (typeof fieldValue === 'string') {
                    value[path[path.length - 1]] = [fieldValue];
                } else if (typeof fieldValue === 'object') {
                    value[path[path.length - 1]] = Object.values(fieldValue);
                } else {
                    value[path[path.length - 1]] = [];
                }
            }

            
            if (code === 'invalid_type' && message.includes('date')) {
                const fieldName = path[path.length - 1];
                if (typeof data[fieldName] === 'number') {
                    fixedData[fieldName] = new Date(data[fieldName]).toISOString();
                }
            }
        });

        return fixedData;
    }
    async processAIResponse(prompt, schema, systemPrompt = '') {
        try {
            const messages = [
                {
                    role: 'system',
                    content: systemPrompt || 'You are a venue coordinator assistant. Provide responses in JSON format.'
                },
                { role: 'user', content: prompt }
            ];

            const { response } = await aiService.generateResponse(messages, {
                includeBackground: false,
                resetHistory: true 
            });

            let jsonData;
            try {
                const jsonMatch = response.match(/{[\s\S]*}/);
                if (jsonMatch) {
                    jsonData = JSON.parse(jsonMatch[0]);
                } else {
                    jsonData = this.structureUnformattedResponse(response);
                }
            } catch (parseError) {
                console.error('Error parsing JSON from AI response:', parseError);
                jsonData = this.structureUnformattedResponse(response);
            }

            return schema.parse(jsonData);
        } catch (error) {
            console.error(`Error in AI processing:`, error);
            throw error;
        }
    }

    async processTextResponse(prompt, systemPrompt = '', conversationId = null) {
        try {
            const messages = [
                {
                    role: 'system',
                    content: systemPrompt || 'You are a venue coordinator assistant.'
                },
                { role: 'user', content: prompt }
            ];

            const { response } = await aiService.generateResponse(messages, {
                conversationId,
                includeHistory: true,
                includeBackground: true
            });

            return response;
        } catch (error) {
            console.error(`Error in AI processing:`, error);
            throw error;
        }
    }
    setupRoutes() {
        this.router.post('/api/summarizeAI', async (req, res) => {
            try {
                if (!req.body?.text) {
                    return res.status(400).json({
                        error: 'Invalid request body. Expected { text: string }',
                        receivedBody: req.body
                    });
                }

                const { text } = req.body;

                const prompt = `
                    Summarize this email chain between the client and venue coordinator.
                    Focus on: organizer, event type, timing, rooms, guest count, 
                    catering, AV needs, drink packages, layout, and special requests.

                    Email content:
                    ${text}
                `;

                const { response } = await aiService.generateResponse([
                    {
                        role: 'system',
                        content: 'You are a venue coordinator who summarizes email conversations clearly and concisely.'
                    },
                    { role: 'user', content: prompt }
                ], {
                    includeHistory: false,
                    resetHistory: true,
                    includeBackground: true
                });

                res.json({ summary: response });

            } catch (error) {
                console.error('Error in summarizeAI:', error);
                res.status(500).json({
                    error: error.message,
                    details: error.stack
                });
            }
        });

        this.router.post('/api/getAIEmail', async (req, res) => {
            try {
                let { aiText, emailText } = req.body;

                const inquirySchema = z.object({
                    inquiryType: z.enum(['availability', 'food and drink packages', 'confirmEvent', 'other']),
                    date: z.string().optional(),
                    time: z.string().optional(),
                    isWeekend: z.boolean().optional(),
                    fromEmail: z.string().optional(),
                    summary: z.string(),
                });

                aiText += `. If no year is specified, assume it's ${moment().year()}. `;

                const messages = [
                    {
                        role: 'system',
                        content: 'You are a venue coordinator assistant analyzing email inquiries.'
                    },
                    {
                        role: 'user',
                        content: `${aiText}\n\nEmail content: ${emailText}`
                    }
                ];

                const { response } = await aiService.generateResponse(messages, {
                    includeBackground: false,
                    includeHistory: false,
                    resetHistory: true,
                    schema: inquirySchema,
                    schemaName: 'inquirySchema'
                });


                let followUpResponse;
                switch (response.inquiryType) {
                    case "availability":
                        followUpResponse = await this.checkAvailabilityAI(response.date, emailText);
                        break;
                    case "confirmEvent":
                        followUpResponse = await aiService.generateResponse([
                            {
                                role: 'user',
                                content: `Generate a confirmation email response for: ${emailText}`
                            }
                        ], {
                            includeBackground: true
                        });
                        break;
                    default:
                        followUpResponse = await aiService.generateResponse([
                            {
                                role: 'user',
                                content: emailText
                            }
                        ], {
                            includeBackground: true
                        });
                }

                res.json({
                    ...response,
                    response: followUpResponse.response,
                });

            } catch (error) {
                console.error('Error in getAIEmail:', error);
                res.status(500).json({
                    error: error.message,
                    details: error.stack
                });
            }
        });
        this.router.post('/api/sendAIEventInformation', async (req, res) => {


            try {
                if (!req.body?.aiText) {
                    return res.status(400).json({
                        error: 'Invalid request body. Expected { aiText: string }',
                        receivedBody: req.body
                    });
                }

                const { aiText, conversationId } = req.body;

                const messages = [
                    {
                        role: 'system',
                        content: 'You extract event details from inquiry emails.'
                    },
                    {
                        role: 'user',
                        content: `
                      
                                Extract event details from this email and provide JSON in this format:
                                {
                                    "name": "contact name",
                                    "email": "contact email",
                                    "phone": "contact phone (optional)",
                                    "partyType": "type of event",
                                    "startTime": "YYYY-MM-DD HH:mm",
                                    "endTime": "YYYY-MM-DD HH:mm",
                                    "room": "requested venue space",
                                    "attendance": "expected guests",
                                    "services": ["array of requested services"],
                                    "notes": "additional details (optional)"
                                }

                                Email content:
                                ${aiText}
                    `
                    }
                ];


                
                let eventDetailsSchema = z.object({
                    name: z.string(),
                    email: z.string(),
                    phone: z.string().optional(),
                    partyType: z.string().optional(),
                    startTime: z.string(),
                    endTime: z.string(),
                    room: z.string(),
                    attendance: z.string(),
                    services: z.union([
                        z.array(z.string()),
                        z.string().transform(str => [str])
                    ]).transform(val => Array.isArray(val) ? val : [val]),
                    notes: z.string().optional()
                });

                const result = await aiService.generateResponse(messages, {
                    conversationId,
                    includeBackground: false,
                    resetHistory: true,
                    schema: eventDetailsSchema,
                    schemaName: 'eventDetails',
                    metadata: { type: 'eventExtraction' }
                });

                
                let eventDetails = result.parsedData;

                
                if (eventDetails.startTime) {
                    eventDetails.startTime = moment.tz(eventDetails.startTime, 'America/New_York')
                        .format('YYYY-MM-DD HH:mm');
                }
                if (eventDetails.endTime) {
                    eventDetails.endTime = moment.tz(eventDetails.endTime, 'America/New_York')
                        .format('YYYY-MM-DD HH:mm');
                }

                res.json({
                    ...eventDetails,
                    conversationId: result.conversationId,
                    messageCount: result.messageCount,
                    historyIncluded: result.historyIncluded
                });

            } catch (error) {
                console.error('Error in sendAIText:', error);
                res.status(500).json({
                    error: error.message,
                    details: error.issues || error.stack
                });
            }
        });

        this.router.post('/api/sendAIText', async (req, res) => {
            try {
                if (!req.body?.aiText) {
                    return res.status(400).json({
                        error: 'Invalid request body. Expected { aiText: string }',
                        receivedBody: req.body
                    });
                }

                const { aiText } = req.body;

                const messages = [
                    {
                        role: 'system',
                        content: 'You are a venue coordinator assistant.'
                    },
                    {
                        role: 'user',
                        content: aiText
                    }
                ];

                const { response } = await aiService.generateResponse(messages, {
                    includeBackground: true,
                    resetHistory: true
                });
                res.send(response);

            } catch (error) {
                console.error('Error in sendAIText:', error);
                res.status(500).json({
                    error: error.message,
                    details: error.issues || error.stack
                });
            }
        });
    }

    formatEmailResponse(response) {
        return `${response.greeting}\n\n${response.mainContent}\n\n${response.nextSteps.join('\n')}\n\n${response.closing}\n\n${response.signature}`;
    }
}

module.exports = EmailProcessorServer;


//--- File: /home/luan_ngo/web/events/routes/ai.js ---

const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');


router.post('/chat', async (req, res) => {
  const { messages, provider } = req.body;
  try {
    
    if (provider) {
      aiService.setProvider(provider);
    }

    
    let conversationHistory = aiService.loadConversationHistory();

    
    conversationHistory.push(...messages);

    
    const aiResponse = await aiService.generateResponse(conversationHistory);

    
    conversationHistory.push({ role: 'assistant', content: aiResponse });

    
    aiService.saveConversationHistory(conversationHistory);

    res.json({ response: aiResponse });
  } catch (error) {
    res.status(500).json({ error: 'AI service error' });
  }
});


router.post('/reset', (req, res) => {
  aiService.saveConversationHistory([]);
  res.json({ message: 'Conversation history reset' });
});

module.exports = router;

