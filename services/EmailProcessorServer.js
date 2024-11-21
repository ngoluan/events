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


        this.setupRoutes();
    }
    getRouter() {
        return this.router;
    }

    async checkAvailabilityAI(firstResponse, emailText) {
        try {
            const calendarEvents = await this.googleCalendarService.listEvents();

            const targetDate = moment(firstResponse.date).startOf('day');

            //is the day a weekend?
            const isWeekend = targetDate.day() === 5 || targetDate.day() === 6; // 5 = Friday, 6 = Saturday
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

            // first check what room should we recommend
            const { roomResponse } = await aiService.generateResponse([

                {
                    role: 'user',
                    content: `Client Inquiry: ${emailText}. Which room are they asking for? Moonlight Lounge or TacoTaco Dining Room (aka Tropical Event Space). If they don't specify, if party is 50 and larger, recommend Moonlight Lounge. If party is below 50, then recommend dining room.`
                }
            ], {
                includeBackground: false,
                resetHistory: false, provider: 'google',
                model: 'gemini-1.5-flash'
            });


            const { availiabiltyResponse } = await aiService.generateResponse([

                {
                    role: 'user',
                    content: `
                        Please analyze the availability for an event request based on the following:

                        Current bookings for ${targetDate.format('YYYY-MM-DD')}:
                        ${JSON.stringify(formattedEvents, null, 2)}

                        The recommended room is ${roomResponse}.
                        
                        Their requested time is ${firstResponse.time}

                        Is there avaialblity or is it already booked?
                    `
                }
            ], {
                includeBackground: false,
                resetHistory: false, provider: 'google',
                model: 'gemini-1.5-flash'
            });

            const { response } = await aiService.generateResponse([

                {
                    role: 'user',
                    content: `
                        Draft a response to the inquiry. Here's the email: ${emailText}

                        We recommend the following room ${roomResponse}

                        Here's the availablity information ${availiabiltyResponse}.

                        If available, provide informatoin on rates and services that we provide.

                        If asked, provide information on packages.

                        The requested day is a weekend: ${isWeekend}.

                        Don't respond with a subject heading or start with Dear.
                    `
                }
            ], {
                includeBackground: true,
                resetHistory: false
            });

            return { response };

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

                const { response } = await aiService.generateResponse([

                    {
                        role: 'user', content: `
                    Summarize this email chain between the client and venue coordinator.
                    Focus on: organizer, event type, timing, rooms, guest count, 
                    catering, AV needs, drink packages, layout, and special requests.

                    Email content:
                    ${text}
                ` }
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
                let { instructions, emailText } = req.body;

                const inquirySchema = z.object({
                    inquiryType: z.enum(['availability', 'food and drink packages', 'confirmEvent', 'other']),
                    date: z.string().optional(),
                    time: z.string().optional(),
                    fromEmail: z.string().optional(),
                    summary: z.string(),
                });

                emailText += instructions;


                const messages = [
                    {
                        role: 'system',
                        content: 'You are a venue coordinator assistant analyzing email inquiries.'
                    },
                    {
                        role: 'user',
                        content: `Email content: ${emailText}. Date should be MM/DD/YYYY.
                        
                        inquiryTypes: 
                        - availability: if it's a new event inquiry and/or guest is asking for availabity for a certain date
                        - food and drink packages: if it is not a new inquiry, and guests are asking for drink and food packages
                        - confirmEvent: if the guest is emailing indicating that they've sent the etransfer and/or accept the contract.
                        
                        `
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
                        followUpResponse = await this.checkAvailabilityAI(response, emailText);
                        break;
                    case "confirmEvent":
                        followUpResponse = await aiService.generateResponse([
                            {
                                role: 'user',
                                content: `Generate a confirmation email response for: ${emailText}. Say that you're now booked.`
                            }
                        ], {
                            includeBackground: true,
                            provider: 'google',
                            model: 'gemini-1.5-flash'
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
