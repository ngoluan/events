const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const moment = require('moment-timezone');
const { z } = require('zod');
const aiService = require('./aiService');
const GoogleCalendarService = require('./googleCalendarService');

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

        this.setupSchemas();
        this.setupRoutes();
    }
    getRouter() {
        return this.router;
    }
    setupSchemas() {

        // Event details schema
        this.eventDetailsSchema = z.object({
            name: z.string(),
            email: z.string(),
            phone: z.string().optional(),
            eventType: z.string(),
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

        // Email analysis schema
        this.emailAnalysisSchema = z.object({
            requestType: z.enum(['AVAILABILITY', 'BOOKING', 'INFORMATION', 'OTHER']),
            clientInfo: z.object({
                name: z.string().optional(),
                preferredContact: z.string().optional()
            }),
            eventDetails: z.object({
                type: z.string().optional(),
                date: z.string().optional(),
                guestCount: z.number().optional(),
                venue: z.string().optional()
            }),
            requirements: z.array(z.string()).optional(),
            urgency: z.enum(['HIGH', 'MEDIUM', 'LOW']),
            followUpNeeded: z.boolean(),
            additionalNotes: z.string().optional()
        });

        // Email response schema
        this.emailResponseSchema = z.object({
            subject: z.string(),
            greeting: z.string(),
            mainContent: z.string(),
            nextSteps: z.array(z.string()),
            closing: z.string(),
            signature: z.string()
        });
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

            const response = await aiService.generateResponse(messages);

            // Enhanced JSON extraction
            let jsonData;
            try {
                const jsonMatch = response.match(/{[\s\S]*}/);
                if (jsonMatch) {
                    jsonData = JSON.parse(jsonMatch[0]);
                } else {
                    console.warn('No JSON found in response, attempting to structure:', response);
                    jsonData = this.structureUnformattedResponse(response);
                }
            } catch (parseError) {
                console.error('Error parsing JSON from AI response:', parseError);
                jsonData = this.structureUnformattedResponse(response);
            }

            try {
                return schema.parse(jsonData);
            } catch (zodError) {
                console.error('Zod validation error:', zodError);
                const fixedData = this.fixCommonDataIssues(jsonData, zodError);
                return schema.parse(fixedData);
            }
        } catch (error) {
            console.error(`Error in AI processing:`, error);
            throw error;
        }
    }
    async checkAvailabilityAI(requestedDate, analysis, venueInfo) {
        try {
            // Get all calendar events
            const events = await this.googleCalendarService.listEvents();

            // Parse the analysis to ensure we have date and time
            const analysisObj = typeof analysis === 'string' ? JSON.parse(analysis) : analysis;

            // Get the requested date details
            const requestDate = moment.tz(requestedDate, 'America/New_York');
            const requestTime = analysisObj.eventDetails?.time || '20:00'; // Default to 8 PM if not specified

            // Create start and end time for requested date
            const requestedDateTime = moment.tz(`${requestedDate} ${requestTime}`, 'YYYY-MM-DD HH:mm', 'America/New_York');
            const requestedEndTime = moment(requestedDateTime).add(4, 'hours'); // Assume 4-hour event if not specified

            // Filter events for the requested date
            const conflictingEvents = events.filter(event => {
                const eventStart = moment.tz(event.start.dateTime || event.start.date, 'America/New_York');
                const eventEnd = moment.tz(event.end.dateTime || event.end.date, 'America/New_York');

                return (
                    (requestedDateTime.isBetween(eventStart, eventEnd, null, '[]')) ||
                    (requestedEndTime.isBetween(eventStart, eventEnd, null, '[]')) ||
                    (eventStart.isBetween(requestedDateTime, requestedEndTime, null, '[]')) ||
                    (eventEnd.isBetween(requestedDateTime, requestedEndTime, null, '[]'))
                );
            });

            // Format conflicts for AI analysis
            const conflictsDescription = conflictingEvents.map(event => ({
                summary: event.summary,
                start: moment.tz(event.start.dateTime || event.start.date, 'America/New_York').format('YYYY-MM-DD HH:mm'),
                end: moment.tz(event.end.dateTime || event.end.date, 'America/New_York').format('YYYY-MM-DD HH:mm'),
                space: event.location || 'Venue'
            }));

            // Generate AI response about availability
            const availabilityMessages = [
                {
                    role: 'system',
                    content: 'You are a venue coordinator checking availability and providing helpful responses.'
                },
                {
                    role: 'user',
                    content: `Analyze this availability request and provide a response:
                    
                    Requested Date: ${requestedDateTime.format('YYYY-MM-DD HH:mm')}
                    Expected Duration: 4 hours
                    
                    Current Bookings:
                    ${JSON.stringify(conflictsDescription, null, 2)}
                    
                    Client's Request Details:
                    ${JSON.stringify(analysisObj, null, 2)}
                    
                    Venue Information:
                    ${venueInfo}
                    
                    Guidelines:
                    - If there are no conflicts, be enthusiastic about availability
                    - If there are conflicts, suggest nearby dates/times that are free
                    - Include relevant venue information for their event type
                    - Be professional but warm
                    - Keep the response concise but informative
                    `
                }
            ];

            const response = await this.processTextResponse(
                availabilityMessages[1].content,
                availabilityMessages[0].content
            );

            return {
                isAvailable: conflictingEvents.length === 0,
                requestedTime: requestedDateTime.format('YYYY-MM-DD HH:mm'),
                conflicts: conflictingEvents.length > 0 ? conflictsDescription : [],
                response: response
            };

        } catch (error) {
            console.error('Error checking availability:', error);
            throw new Error(`Failed to check availability: ${error.message}`);
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
    async processTextResponse(prompt, systemPrompt = '') {
        try {
            const messages = [
                {
                    role: 'system',
                    content: systemPrompt || 'You are a venue coordinator assistant.'
                },
                { role: 'user', content: prompt }
            ];

            return await aiService.generateResponse(messages);
        } catch (error) {
            console.error(`Error in AI processing:`, error);
            throw error;
        }
    }

    setupRoutes() {
        this.router.post('/api/summarizeAI', async (req, res) => {
            try {
                if (!req.body || typeof req.body.text !== 'string') {
                    return res.status(400).json({
                        error: 'Invalid request body. Expected { text: string }',
                        receivedBody: req.body
                    });
                }

                const { text } = req.body;

                const prompt = `
                    i'm renting an event space. the email chain below is correspondence between the client and i. 
                    summarize the email, telling me what the clients needs are and what i agreed to provide. 
                    focus on the name of the organizer,type of event, start and end time, the rooms, number of guests, 
                    catering choices, AV needs, drink packages and layout or tables and chairs, and special requests. 

                    Email content:
                    ${text}
                `;

                const summary = await this.processTextResponse(
                    prompt,
                    'You are a venue coordinator who summarizes email conversations clearly and concisely.'
                );

                res.send(summary);

            } catch (error) {
                console.error('Error in summarizeAI:', error);
                res.status(500).json({
                    error: error.message,
                    details: error.stack
                });
            }
        });

        // First update the schema to match the original logic
        const inquiryAnalysisSchema = z.object({
            inquiryType: z.enum(['AVAILABILITY', 'BOOKING', 'CONFIRMATION', 'OTHER']),
            clientInfo: z.object({
                name: z.string().optional(),
                email: z.string().optional(),
                preferredContact: z.string().optional()
            }),
            eventDetails: z.object({
                type: z.string().optional(),
                date: z.string().optional(),
                time: z.string().optional(),
                guestCount: z.number().optional(),
                venue: z.string().optional(),
                isWeekend: z.boolean().optional()
            }),
            summary: z.string(),
            urgency: z.enum(['HIGH', 'MEDIUM', 'LOW']),
            requirements: z.array(z.string()).optional(),
            followUpNeeded: z.boolean()
        });

        // Update the route implementation
        this.router.post('/api/getAIEmail', async (req, res) => {
            try {
                // Validate request
                const requestSchema = z.object({
                    emailText: z.string(),
                    specificInstructions: z.string().optional()
                });

                const validatedRequest = requestSchema.parse(req.body);
                const { emailText, specificInstructions } = validatedRequest;

                // Define the analysis function
                const analyzeEmailFunction = {
                    name: 'analyzeEmailInquiry',
                    description: 'Analyze an event inquiry email and categorize the type of request',
                    parameters: {
                        type: 'object',
                        properties: {
                            inquiryType: {
                                type: 'string',
                                enum: ['AVAILABILITY', 'BOOKING', 'CONFIRMATION', 'OTHER'],
                                description: 'The type of inquiry'
                            },
                            clientInfo: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    email: { type: 'string' },
                                    preferredContact: { type: 'string' }
                                }
                            },
                            eventDetails: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string' },
                                    date: { type: 'string' },
                                    time: { type: 'string' },
                                    guestCount: { type: 'number' },
                                    venue: { type: 'string' },
                                    isWeekend: { type: 'boolean' }
                                }
                            },
                            summary: { type: 'string' },
                            urgency: {
                                type: 'string',
                                enum: ['HIGH', 'MEDIUM', 'LOW']
                            },
                            requirements: {
                                type: 'array',
                                items: { type: 'string' }
                            },
                            followUpNeeded: { type: 'boolean' }
                        },
                        required: ['inquiryType', 'summary', 'urgency', 'followUpNeeded']
                    }
                };

                // Get initial analysis
                const analysisMessages = [
                    {
                        role: 'system',
                        content: 'You analyze event inquiries and categorize them appropriately.'
                    },
                    {
                        role: 'user',
                        content: `Analyze this inquiry and categorize it:\n\n${emailText}\n${specificInstructions ? `\nConsiderations: ${specificInstructions}` : ''}`
                    }
                ];

                const analysis = await aiService.generateResponse(
                    analysisMessages,
                    { function_call: { name: 'analyzeEmailInquiry' }, functions: [analyzeEmailFunction] }
                );

                const validatedAnalysis = inquiryAnalysisSchema.parse(JSON.parse(analysis));

                // Based on analysis type, determine response approach
                let responseContent;
                switch (validatedAnalysis.inquiryType) {
                    case 'AVAILABILITY': {
                        const availabilityResult = await this.checkAvailabilityAI(
                            validatedAnalysis.eventDetails.date,
                            validatedAnalysis,
                            this.templates.backgroundInfo
                        );

                        // Use the availability result to craft the final response
                        responseContent = availabilityResult.response;

                        // Add availability details to the analysis response
                        validatedAnalysis.availabilityDetails = {
                            isAvailable: availabilityResult.isAvailable,
                            requestedTime: availabilityResult.requestedTime,
                            conflicts: availabilityResult.conflicts
                        };

                        break;
                    }

                    case 'CONFIRMATION': {
                        responseContent = await aiService.generateResponse(
                            [
                                {
                                    role: 'system',
                                    content: 'You are a venue coordinator writing brief, welcoming confirmation emails.'
                                },
                                {
                                    role: 'user',
                                    content: `Write a brief confirmation email for this inquiry: 
                                        ${JSON.stringify(validatedAnalysis)}
                                        
                                        Guidelines:
                                        - Thank them for confirming
                                        - Mention you'll send a calendar invite
                                        - Keep it to 2-3 sentences
                                        - Be warm but professional
                                        - No need for JSON format, just write the email text
                                        `
                                }
                            ]
                        );
                        break;
                    }

                    default: {
                        responseContent = await aiService.generateResponse(
                            [
                                {
                                    role: 'system',
                                    content: 'You are a venue coordinator writing professional response emails.'
                                },
                                {
                                    role: 'user',
                                    content: `Write a response email based on this analysis:
                                        ${JSON.stringify(validatedAnalysis)}
                                        
                                        Use this venue information:
                                        ${this.templates.backgroundInfo}
                                        
                                        Guidelines:
                                        - Write in a professional but friendly tone
                                        - Include relevant venue details
                                        - Address their specific questions/needs
                                        - Include clear next steps
                                        - No need for JSON format, just write the email text
                                        `
                                }
                            ]
                        );
                    }
                }

                // Replace the response schema validation with simple text handling
                let formattedResponse;
                if (validatedAnalysis.inquiryType === 'AVAILABILITY') {
                    // Keep the existing availability response handling
                    const responseSchema = z.object({
                        subject: z.string(),
                        greeting: z.string(),
                        mainContent: z.string(),
                        nextSteps: z.array(z.string()),
                        closing: z.string(),
                        signature: z.string()
                    });
                    const validatedResponse = responseSchema.parse(JSON.parse(responseContent));
                    formattedResponse = this.formatEmailResponse(validatedResponse);
                } else {
                    // For confirmation and default cases, use the text response directly
                    formattedResponse = responseContent;
                }

                res.json({
                    analysis: validatedAnalysis,
                    response: formattedResponse
                });

            } catch (error) {
                console.error('Error in getAIEmail:', error);
                if (error instanceof z.ZodError) {
                    res.status(400).json({
                        error: 'Validation error',
                        details: error.issues
                    });
                } else {
                    res.status(500).json({
                        error: error.message,
                        details: error.stack
                    });
                }
            }
        });

        // Route for extracting event details from emails
        this.router.post('/api/sendAIText', async (req, res) => {
            try {
                if (!req.body || !req.body.aiText) {
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
                        "eventType": "type of event",
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
