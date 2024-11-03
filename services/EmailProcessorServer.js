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

            const { backgroundInfo } = await backgroundService.getBackground();

            const prompt = `
                Please analyze the availability for an event request based on the following:

                Current bookings for ${targetDate.format('YYYY-MM-DD')}:
                ${JSON.stringify(formattedEvents, null, 2)}

                Client Inquiry:
                ${emailText}
            `;

            const { response } = await aiService.generateResponse([
                {
                    role: 'system',
                    content: 'You are a venue booking assistant. Provide clear, professional responses about venue availability.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ], {
                includeBackground: true,
                resetHistory: true // Start fresh for availability checks
            });

            return response;

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

            // Fix array issues
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

            // Fix date issues
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
                resetHistory: true // Don't maintain history for JSON parsing responses
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
                    response: followUpResponse,
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


                // Event details schema
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

                // Get the parsed data from the response
                let eventDetails = result.parsedData;

                // Format dates if they exist
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

                const prompt = `
                    ${this.templates.eventPrompt}
                    
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
                `;

                const eventDetails = await this.processAIResponse(
                    prompt,
                    this.eventDetailsSchema,
                    'You extract event details from inquiry emails.'
                );

                // Format dates
                if (eventDetails.startTime) {
                    eventDetails.startTime = moment.tz(eventDetails.startTime, 'America/New_York')
                        .format('YYYY-MM-DD HH:mm');
                }
                if (eventDetails.endTime) {
                    eventDetails.endTime = moment.tz(eventDetails.endTime, 'America/New_York')
                        .format('YYYY-MM-DD HH:mm');
                }

                res.json(eventDetails);

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
