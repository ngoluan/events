
//--- File: /home/luan_ngo/web/events/services/User.js ---
const fs = require('fs');
const path = require('path');

class User {
    constructor() {
        this.settingsPath = path.join(__dirname, '..', 'data', 'userSettings.json');
        this.settings = null;
    }
    async loadSettings() {
        try {
            const data = await fs.promises.readFile(this.settingsPath, 'utf8');
            this.settings = JSON.parse(data);
            return this.settings;
        } catch (error) {
            if (error.code === 'ENOENT') {
                const defaultSettings = {
                    emailCategories: {
                        'event_platform': 'Emails mentioning Tagvenue or Peerspace',
                        'event': 'Emails related to event bookings, catering, drinks. do not include opentable emails.',
                        'other': 'Any other type of email, including receipts',
                    },
                };
                await this.saveSettings(defaultSettings);
                this.settings = defaultSettings;
                return defaultSettings;
            }
            throw error;
        }
    }

    async saveSettings(settings) {
        await fs.promises.writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
        this.settings = settings;
    }

    getCategorySchema() {
        const categories = Object.keys(this.settings?.emailCategories || { 'other': '' });
        return z.object({
            category: z.enum(categories),
        });
    }
}

module.exports = User;

//--- File: /home/luan_ngo/web/events/services/EmailProcessorServer.js ---
const express = require('express');
const moment = require('moment-timezone');
const { z } = require('zod');
const aiService = require('./aiService');
const GoogleCalendarService = require('./googleCalendarService');
var plivo = require('plivo');
const historyManager = require('./HistoryManager');
const Utils = require('./Utils');
const User = require('./User');

class EmailProcessorServer {
    constructor(googleAuth, gmailService, eventService) {  
        this.router = express.Router();
        this.router.use(express.json());
        this.router.use(express.urlencoded({ extended: true }));
        this.googleCalendarService = new GoogleCalendarService(googleAuth);
        this.gmailService = gmailService;  
        this.eventService = eventService;
        this.user = new User();

        this.setupRoutes();
    }
    
      async setupUserSettings() {
        this.user = new User();
        this.user.loadSettings();
      }
    getRouter() {
        return this.router;
    }

    async checkAvailabilityAI(firstResponse, emailText) {
        try {
            const calendarEvents = await this.googleCalendarService.listEvents();

            const targetDate = moment(firstResponse.date).startOf('day');

            
            const isWeekend = targetDate.day() === 5 || targetDate.day() === 6; 
            const relevantEvents = calendarEvents.filter(event => {
                const eventDate = moment(event.start.dateTime || event.start.date).startOf('day');
                return eventDate.isSame(targetDate);
            });

            const formattedEvents = relevantEvents.map(event => ({
                name: event.summary,
                startDate: moment(event.start.dateTime || event.start.date).format('HH:mm'),
                endDate: moment(event.end.dateTime || event.end.date).format('HH:mm')
            }));

            const roomResult = await aiService.generateResponse([
                {
                    role: 'user',
                    content: `Client Inquiry: ${emailText}. Which room are they asking for? Moonlight Lounge or TacoTaco Dining Room (aka Tropical Event Space). If they don't specify, if party is 50 and larger, recommend Moonlight Lounge. If party is below 50, then recommend dining room.`
                }
            ], {
                includeBackground: false,
                resetHistory: false,
                provider: 'google',
                model: 'gemini-1.5-flash'
            });

            const roomResponse = roomResult.response;

            const availabilityResult = await aiService.generateResponse([
                {
                    role: 'user',
                    content: `
                        Please analyze the availability for an event request based on the following:
            
                        Current bookings for ${targetDate.format('YYYY-MM-DD')}:
                        ${JSON.stringify(formattedEvents, null, 2)}
            
                        The recommended room is "${roomResponse}".
                        
                        Their requested time is ${firstResponse.time}
            
                        Is there availability or is it already booked?

                        The dining room and moonlight lounge are separate and can be booked separately.
                    `
                }
            ], {
                includeBackground: false,
                resetHistory: false,
                provider: 'google',
                model: 'gemini-1.5-flash'
            });

            const availabilityResponse = availabilityResult.response;

            const { response } = await aiService.generateResponse([

                {
                    role: 'user',
                    content: `
                        Draft a response to the inquiry. Here's the email: ${emailText}

                        Here's the availablity information "${availabilityResponse}".

                        Don't respond with a subject heading or start with Dear. Be concise. 

                        If they mention food or drinks, provide them with information.                        
                    `
                }
            ], {
                includeBackground: true,
                resetHistory: false,
                provider: 'google',
                model: 'gemini-1.5-flash'
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


    setupRoutes() {
        this.router.get('/api/triggerEmailSuggestions', async (req, res) => {
            try {
                const result = await this.getAndMakeSuggestionsFromEmails();
                res.json(result);
            } catch (error) {
                console.error('Error triggering email suggestions:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.router.post('/api/smsReply', async (req, res) => {
            try {
                const { From, To, Text } = req.body;
                const result = await this.handleSMSReply(Text, From);

                if (result.success) {
                    
                    await this.sendSMS({
                        to: From,
                        message: result.message
                    });
                    res.json(result);
                } else {
                    
                    await this.sendSMS({
                        to: From,
                        message: `Error: ${result.message}`
                    });
                    res.status(400).json(result);
                }
            } catch (error) {
                console.error('Error processing SMS reply:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.router.post('/api/summarizeAI', async (req, res) => {
            try {
                if (!req.body?.text) {
                    return res.status(400).json({
                        error: 'Invalid request body. Expected { text: string }',
                        receivedBody: req.body
                    });
                }

                const { text } = req.body;
                const cleanedText = Utils.cleanEmailContent(text);

                const { response } = await aiService.generateResponse([

                    {
                        role: 'user', content: `
                    Summarize this email chain between the client and venue coordinator.
                    Focus on: organizer, event type, timing, rooms, guest count, 
                    catering, AV needs, drink packages, layout, and special requests.

                    Email content:
                    ${cleanedText}
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
                let { emailText, eventDetails } = req.body;

                const inquirySchema = z.object({
                    inquiries: z.array(
                        z.object({
                            inquiryType: z.enum(['availability', 'additionalEventInfo', 'foodOrDrinkQuestion', 'confirmEvent','askingForContract', 'other']),
                            date: z.string().optional(),
                            time: z.string().optional(),
                            fromEmail: z.string().optional(),
                            summary: z.string(),
                        })
                    )
                });


                
                let prompt = `
                    Email content: ${emailText}.
                `;

                if (eventDetails) {
                    prompt += `
                    Currently has an event iwht us, here are event details:
                    ${JSON.stringify(eventDetails, null, 2)}
                    `;
                }
                else {
                    prompt += `
                        This person does not yet have an event with us. 

                    `
                }

                prompt += `
                Please analyze the email and determine the inquiry type. Provide a summary.
                Inquiry types:
                - availability: asking for availability and pricing
                - additionalEventInfo: already have an event (i.e. has associated event details) and providing drink or food choices
                - foodOrDrinkQuestion: asking about food or drink packages
                - confirmEvent: indicated that they agree to the contract and sent in deposit
                - askingForContract: indicated that they're ready to book
                - other: all else
                `;

                const messages = [
                    {
                        role: 'system',
                        content: 'You are a venue coordinator assistant analyzing email inquiries.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ];

                const { parsedData } = await aiService.generateResponse(messages, {
                    includeBackground: false,
                    includeHistory: false,
                    resetHistory: true,
                    schema: inquirySchema,
                    schemaName: 'inquirySchema'
                });


                let followUpResponses = [];

                
                
                let hasIncludedBackground = false;
                const inquiries = parsedData.inquiries || [];

                for (const inquiry of inquiries) {
                    let followUpResponse;

                    switch (inquiry.inquiryType) {
                        case "availability":
                            followUpResponse = await this.checkAvailabilityAI(inquiry, emailText);
                            hasIncludedBackground = hasIncludedBackground || followUpResponse.includedBackground;
                            break;
                        case "confirmEvent":
                            followUpResponse = await aiService.generateResponse([
                                {
                                    role: 'user',
                                    content: `Generate a confirmation email response for: ${emailText}. Say that you're now booked.`
                                }
                            ], {
                                includeBackground: !hasIncludedBackground,
                                provider: 'google',
                                model: 'gemini-1.5-flash'
                            });
                            hasIncludedBackground = hasIncludedBackground || followUpResponse.includedBackground;
                            break;
                        case "additionalEventInfo":
                            followUpResponse = await aiService.generateResponse([
                                {
                                    role: 'user',
                                    content: `Generate a response addressing the ${inquiry.inquiryType} inquiry: ${emailText}`
                                }
                            ], {
                                includeBackground: !hasIncludedBackground,
                                provider: 'google',
                                model: 'gemini-1.5-flash'
                            });
                            hasIncludedBackground = hasIncludedBackground || followUpResponse.includedBackground;
                            break;
                        case "foodOrDrinkQuestion":
                            followUpResponse = await aiService.generateResponse([
                                {
                                    role: 'user',
                                    content: `Generate a response addressing the ${inquiry.inquiryType} inquiry: ${emailText}`
                                }
                            ], {
                                includeBackground: !hasIncludedBackground,
                                provider: 'google',
                                model: 'gemini-1.5-flash'
                            });
                            hasIncludedBackground = hasIncludedBackground || followUpResponse.includedBackground;
                            break;
                        case "askingForContract":
                            followUpResponse = await aiService.generateResponse([
                                {
                                    role: 'user',
                                    content: `Generate a response indicating that we'll send over a contract with all the details. If no phone number or email address is provided, ask for one.  Anwer any other question they may have: ${emailText}`
                                }
                            ], {
                                includeBackground: !hasIncludedBackground,
                                provider: 'google',
                                model: 'gemini-1.5-flash'
                            });
                            hasIncludedBackground = hasIncludedBackground || followUpResponse.includedBackground;
                            break;
                        default:
                            followUpResponse = await aiService.generateResponse([
                                {
                                    role: 'user',
                                    content: `Generate a general response for: ${emailText}`
                                }
                            ], {
                                includeBackground: !hasIncludedBackground,
                                provider: 'google',
                                model: 'gemini-1.5-flash'
                            });
                            hasIncludedBackground = hasIncludedBackground || followUpResponse.includedBackground;
                    }

                    followUpResponses.push({
                        inquiryType: inquiry.inquiryType,
                        response: followUpResponse.response,
                        summary: inquiry.summary,
                        date: inquiry.date,
                        time: inquiry.time,
                        fromEmail: inquiry.fromEmail
                    });
                }

                let finalResponse;

                if (followUpResponses.length > 1) {
                    
                    const responsesContext = followUpResponses.map(r =>
                        `${r.inquiryType}: ${r.response}`
                    ).join('\n\n');

                    const combinedResponse = await aiService.generateResponse([
                        {
                            role: 'system',
                            content: 'You are a venue coordinator assistant. Combine the following separate responses into one coherent, well-structured email response. Maintain a professional but friendly tone.'
                        },
                        {
                            role: 'user',
                            content: `Original email: ${emailText}\n\nResponses to combine:\n${responsesContext}`
                        }
                    ], {
                        includeBackground: false,
                        provider: 'google',
                        model: 'gemini-1.5-flash'
                    });

                    finalResponse = {
                        inquiries: followUpResponses,
                        response: combinedResponse.response,
                        multipleInquiries: true,
                        reasoning:followUpResponses
                    };
                } else {
                    
                    finalResponse = {
                        inquiries: followUpResponses,
                        response: followUpResponses[0]?.response || "No response generated",
                        multipleInquiries: false
                    };
                }

                res.json(finalResponse);


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
                const cleanedText = Utils.cleanEmailContent(aiText);

                const messages = [
                    {
                        role: 'system',
                        content: 'You extract event details from inquiry emails.'
                    },
                    {
                        role: 'user',
                        content: `
                      ${cleanedText}
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
    splitMessage(text, maxLength) {
        const chunks = [];
        let currentChunk = '';

        text.split('\n').forEach(line => {
            if ((currentChunk + line + '\n').length > maxLength) {
                chunks.push(currentChunk);
                currentChunk = line + '\n';
            } else {
                currentChunk += line + '\n';
            }
        });

        if (currentChunk) {
            chunks.push(currentChunk);
        }

        return chunks;
    }
      async getAndMakeSuggestionsFromEmails() {
        try {
            const newEmails = await this.gmailService.getAllEmails(25, false, true);

            
            const eventEmail = newEmails
                .filter(email =>
                    email.category === 'event' &&
                    !email.hasNotified &&
                    !email.labels.includes('SENT') && 
                    email.labels.includes('INBOX')  
                )[0];

            if (!eventEmail) {
                console.log('No new unnotified event-related emails to process.');
                return {
                    success: true,
                    message: 'No new unnotified event-related emails to process',
                    processedCount: 0
                };
            }

            try {
                let eventDetails = null;
                if (eventEmail.associatedEventId) {
                    const eventId = parseInt(eventEmail.associatedEventId);
                    if (!isNaN(eventId)) {
                        eventDetails = await this.eventService.getEvent(eventId);
                    }
                }

                
                const threadMessages = await this.gmailService.getThreadMessages(eventEmail.threadId);
                const previousMessage = threadMessages
                    .filter(msg => msg.id !== eventEmail.id)
                    .sort((a, b) => Number(b.internalDate) - Number(a.internalDate))[0];

                const cleanedEmailContent = Utils.cleanEmailContent(eventEmail.text || eventEmail.snippet || '');

                
                const summaryResponse = await aiService.generateResponse([
                    {
                        role: 'system',
                        content: 'You are a venue coordinator assistant analyzing email conversations.'
                    },
                    {
                        role: 'user',
                        content: `
                            Please provide a concise but detailed summary of this email conversation that addresses.
    
                            Current Email:
                            Subject: ${eventEmail.subject}
                            Content: ${cleanedEmailContent}
    
                            ${eventDetails ? `
                            Existing Event Details:
                            - Event Name: ${eventDetails.name}
                            - Date: ${eventDetails.startTime}
                            - Guest Count: ${eventDetails.attendance}
                            - Room: ${eventDetails.room}
                            - Services: ${eventDetails.services}
                            - Notes: ${eventDetails.notes}
    
                            Summarize the email Focus on the most recent email. Please incorporate relevant event details into the summary if they relate to the email conversation.
                            ` : ''}
    
                            Provide a clear, summary in 4-5 sentences.
                        `
                    }
                ], {
                    includeBackground: false,
                    resetHistory: true,
                    provider: 'google',
                    model: 'gemini-1.5-flash'
                });
    

                const shortId = `1${eventEmail.id.substring(0, 3)}`;

                
                const aiEmailResponse = await this.getAIEmail({
                    emailText: cleanedEmailContent,
                    eventDetails: eventDetails || {}
                });
                
                const detailsContent = `
                New Event Email (Part 1/2):
                
                From: ${eventEmail.from}
                
                Summary:
                ${summaryResponse.response}
                
                Reply Options:
                YES${shortId} - Send proposed response
                EDIT${shortId} - Modify response
                VIEW${shortId} - See full response
                `.trim();

                await this.sendSMS({
                    to: process.env.NOTIFICATION_PHONE_NUMBER,
                    message: detailsContent
                });

                
                const responseContent = `
                Proposed Response (Part 2/2):
                
                ${this.truncateText(aiEmailResponse.response, 1400)}
                `.trim();

                await this.sendSMS({
                    to: process.env.NOTIFICATION_PHONE_NUMBER,
                    message: responseContent
                });

                
                historyManager.addEntry({
                    type: 'pendingEmailResponse',
                    shortId: shortId,
                    emailId: eventEmail.id,
                    proposedEmail: aiEmailResponse.response,
                    emailSubject: `Re: ${eventEmail.subject}`,
                    emailRecipient: eventEmail.from.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0],
                    timestamp: new Date().toISOString()
                });

                
                eventEmail.hasNotified = true;
                await this.gmailService.updateEmailInCache(eventEmail);

                return {
                    success: true,
                    message: `Processed new email`,
                    processedCount: 1
                };

            } catch (emailError) {
                console.error(`Error processing email ${eventEmail.id}:`, emailError);
                throw emailError;
            }

        } catch (error) {
            console.error('Error in getAndMakeSuggestionsFromEmails:', error);
            return {
                success: false,
                error: error.message,
                processedCount: 0
            };
        }
    }

    
    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;

        const truncated = text.slice(0, maxLength - 3);
        const lastSpace = truncated.lastIndexOf(' ');

        if (lastSpace === -1) return truncated + '...';
        return truncated.slice(0, lastSpace) + '...';
    }


    
    async getAIEmail(payload) {
        try {
            const { emailText, eventDetails } = payload;

            const aiResponse = await aiService.generateResponse([
                {
                    role: 'system',
                    content: 'You are a venue coordinator assistant analyzing email inquiries.'
                },
                {
                    role: 'user',
                    content: `
                        Analyze and respond to this email. ${eventDetails ? 'Consider the existing event details below.' : ''}
                        
                        Email content: ${emailText}
                        ${eventDetails ? `\nExisting Event Details: ${JSON.stringify(eventDetails, null, 2)}` : ''}
                    `
                }
            ], {
                includeBackground: true,
                resetHistory: true,
                provider: 'google',
                model: 'gemini-1.5-flash'
            });

            return {
                response: aiResponse.response,
                summary: aiResponse.response.split('\n')[0] 
            };

        } catch (error) {
            console.error('Error generating AI response:', error);
            throw error;
        }
    }
    
    async handleSMSReply(messageText, fromNumber) {
        try {
            
            const match = messageText.trim().match(/^(YES|EDIT)([0-9a-zA-Z]+)(?:\s+(.*))?$/i);

            if (!match) {
                return {
                    success: false,
                    message: 'Invalid format. Please reply with YES{id} or EDIT{id} {new_message}'
                };
            }

            const [, command, shortId, additionalText] = match;
            const upperCommand = command.toUpperCase();

            
            const pendingEmail = historyManager.getRecentEntriesByType('pendingEmailResponse')
                .find(entry => entry.shortId === shortId);

            if (!pendingEmail) {
                return {
                    success: false,
                    message: `No pending email found for ID ${shortId}`
                };
            }

            if (upperCommand === 'YES') {
                
                await this.gmailService.sendEmail(
                    pendingEmail.emailRecipient,
                    pendingEmail.emailSubject,
                    pendingEmail.proposedEmail
                );

                return {
                    success: true,
                    message: 'Email sent successfully'
                };
            } else if (upperCommand === 'EDIT' && additionalText) {
                
                await this.gmailService.sendEmail(
                    pendingEmail.emailRecipient,
                    pendingEmail.emailSubject,
                    additionalText
                );

                return {
                    success: true,
                    message: 'Modified email sent successfully'
                };
            }

            return {
                success: false,
                message: 'Invalid command format'
            };
        } catch (error) {
            console.error('Error handling SMS reply:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    async sendSMS(data) {
        try {
            const authId = process.env.PLIVO_AUTH_ID;
            const authToken = process.env.PLIVO_AUTH_TOKEN;
            const senderNumber = process.env.PLIVO_PHONE_NUMBER;

            if (!authId || !authToken || !senderNumber) {
                throw new Error('Missing Plivo credentials in environment variables');
            }

            let destinationNumber = data.to;
            if (destinationNumber.length === 10) {
                destinationNumber = "1" + destinationNumber;
            }

            const payload = {
                src: senderNumber,
                dst: destinationNumber,
                text: data.message.trim()
            };

            const client = new plivo.Client(authId, authToken);
            const messageResponse = await client.messages.create(payload);

            
            historyManager.addEntry({
                type: 'sendSMS',
                to: destinationNumber,
                messageLength: data.message.length,
                summary: data.summary || 'SMS notification sent',
                messageId: messageResponse.messageUuid,
                status: messageResponse.message
            });

            return {
                success: true,
                messageId: messageResponse.messageUuid,
                status: messageResponse.message
            };

        } catch (error) {
            console.error('Error sending SMS:', error);

            
            historyManager.addEntry({
                type: 'sendSMS_failed',
                to: data.to,
                error: error.message,
                messageLength: data.message?.length || 0
            });

            throw new Error(`Failed to send SMS: ${error.message}`);
        }
    }


}

module.exports = EmailProcessorServer;


//--- File: /home/luan_ngo/web/events/routes/BackgroundRoutes.js ---


const express = require('express');
const router = express.Router();
const backgroundService = require('../services/BackgroundService');


router.get('/api/settings/background', (req, res) => {
    try {
        const data = backgroundService.getBackground();
        res.json(data);
    } catch (error) {
        console.error('Error retrieving background info:', error);
        res.status(500).json({
            error: 'Failed to retrieve background information',
            details: error.message
        });
    }
});


router.post('/api/settings/background', (req, res) => {
    try {
        if (!req.body || typeof req.body.backgroundInfo !== 'string') {
            return res.status(400).json({
                error: 'Invalid request body. Expected { backgroundInfo: string }',
                receivedBody: req.body
            });
        }

        const success = backgroundService.saveBackground(req.body.backgroundInfo);

        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to save background information' });
        }
    } catch (error) {
        console.error('Error saving background info:', error);
        res.status(500).json({
            error: 'Failed to save background information',
            details: error.message
        });
    }
});

module.exports = router;

//--- File: /home/luan_ngo/web/events/data/userSettings.json ---
{
    "emailCategories": [
        {
            "name": "event_platform",
            "description": "Emails mentioning Tagvenue or Peerspace"
        },
        {
            "name": "event",
            "description": "Emails related to event bookings, catering, drinks. do not include opentable emails."
        },
        {
            "name": "other",
            "description": "Any other type of email, including receipts"
        }
    ]
}

//--- File: /home/luan_ngo/web/events/public/scripts.js ---



export class EventManageApp {
    constructor() {
        this.calendarEvents = [];
        this.mainCalendar = null;
        this.fuse = null;
        this.contacts = [];
        this.currentId = -1;
        this.emailProcessor = new EmailProcessor(this);
        this.userEmail = '';
        const showImportantSetting = localStorage.getItem('showImportantEmails');
        this.emailFilters = {
            showImportant: showImportantSetting === null ? false : showImportantSetting === 'true'
        };
        this.backgroundInfo = {};
        this.emailsLoaded = false;
        this.emailEventUpdater = new EmailEventUpdater(this);
        this.initializeToastContainer();

    }
    async init() {
        
        this.sounds = {
            orderUp: new Howl({ src: ['./orderup.m4a'] })
        };

        
        await this.loadTemplates();

        this.syncEvents();
        this.initializeMaximizeButtons();
        await this.initializeFuse();

        
        this.registerEvents();

        
        await this.getAllContacts();
        this.createCalendar();
        this.loadInitialEmails();

        fetch(`/ai/resetHistory`);

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('oauth') === 'success') {
            const response = await $.get('/api/getConnectedEmail');
            if (response.email) {
                this.setConnectedEmail(response.email);
            }
        }

        $(document).on('eventDetailsReceived', async (e, eventDetails) => {
            const lastId = this.contacts.length > 0 ? this.contacts[this.contacts.length - 1].id : 0;
            eventDetails.id = lastId + 1;
            this.contacts.push(eventDetails);
            this.loadContact(eventDetails.id);
        });

        this.initializeBackgroundInfo();
        this.initializeMobileNavigation();
    }
    
    initializeMobileNavigation() {
        window.scrollToSection = (sectionId) => {
            const section = document.getElementById(sectionId);
            if (section) {
                
                document.querySelectorAll('.btm-nav button').forEach(btn => {
                    btn.classList.remove('active');
                });

                
                const button = document.querySelector(`.btm-nav button[onclick*="${sectionId}"]`);
                if (button) {
                    button.classList.add('active');
                }

                
                const headerOffset = 60; 
                const elementPosition = section.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        };

        
        document.querySelectorAll('.btm-nav button').forEach(button => {
            button.addEventListener('click', function () {
                
                document.querySelectorAll('.btm-nav button').forEach(btn => {
                    btn.classList.remove('active');
                });

                
                this.classList.add('active');
            });
        });

        
        window.addEventListener('scroll', () => {
            const sections = ['contacts', 'info', 'messages', 'actions', 'calendar'];
            let currentSection = '';

            sections.forEach(sectionId => {
                const section = document.getElementById(sectionId);
                if (section) {
                    const rect = section.getBoundingClientRect();
                    if (rect.top <= 100 && rect.bottom >= 100) {
                        currentSection = sectionId;
                    }
                }
            });

            if (currentSection) {
                document.querySelectorAll('.btm-nav button').forEach(btn => {
                    btn.classList.remove('active');
                });
                const activeButton = document.querySelector(`.btm-nav button[onclick*="${currentSection}"]`);
                if (activeButton) {
                    activeButton.classList.add('active');
                }
            }
        });
    }
    showReceiptManager() {
        if (this.currentId === -1) {
            this.showToast("Error: No contact selected.", "error");
            return;
        }

        const contact = _.find(this.contacts, ["id", this.currentId]);
        if (!contact) {
            this.showToast("Error: Contact not found.", "error");
            return;
        }

        const rentalFee = parseFloat($("#infoRentalRate").val()) || 0;
        window.currentReceipt = new ReceiptManager(rentalFee);
    }

    initializeToastContainer() {
        
        if (!document.getElementById('toast-container')) {
            const toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2';
            document.body.appendChild(toastContainer);
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');

        
        toast.className = `alert shadow-lg max-w-sm opacity-0 transform translate-x-full transition-all duration-300`;

        
        switch (type) {
            case 'success':
                toast.className += ' alert-success';
                break;
            case 'error':
                toast.className += ' alert-error';
                break;
            case 'warning':
                toast.className += ' alert-warning';
                break;
            default:
                toast.className += ' alert-info';
        }

        toast.innerHTML = `
            <div class="flex items-center justify-between w-full">
                <span class="text-sm">${message}</span>
                <button class="btn btn-ghost btn-xs" aria-label="Close">
                    <i class="bi bi-x text-lg"></i>
                </button>
            </div>
        `;

        
        const container = document.getElementById('toast-container');
        container.appendChild(toast);

        
        requestAnimationFrame(() => {
            toast.className = toast.className.replace('opacity-0 translate-x-full', 'opacity-100 translate-x-0');
        });

        
        const closeButton = toast.querySelector('button');
        closeButton.onclick = () => {
            removeToast(toast);
        };

        
        setTimeout(() => {
            removeToast(toast);
        }, 3000);

        function removeToast(toast) {
            toast.className = toast.className.replace('opacity-100 translate-x-0', 'opacity-0 translate-x-full');
            setTimeout(() => {
                toast?.remove();
            }, 300); 
        }
    }

    async loadInitialEmails() {
        if (this.emailsLoaded) return;

        try {
            const emails = await this.readGmail();
            this.emailsLoaded = true;
            return emails;
        } catch (error) {
            console.error("Failed to load initial emails:", error);
            throw error;
        }
    }

    adjustMessagesContainerHeight() {
        const messagesCard = document.querySelector('#messages .card-body');
        const messagesContainer = document.querySelector('.messages-container');

        if (!messagesCard || !messagesContainer) return;

        
        const containerTop = messagesContainer.offsetTop;

        
        const cardContentHeight = messagesCard.clientHeight;

        
        const newHeight = cardContentHeight - containerTop;
        messagesContainer.style.maxHeight = `${Math.max(newHeight, 100)}px`;
    }



    async initiateGoogleOAuth() {
        try {
            const response = await $.get('/auth/google');
            if (response.authUrl) {
                window.location.href = response.authUrl;
            } else {
                alert('Failed to initiate Google OAuth.');
            }
        } catch (error) {
            console.error('Error initiating Google OAuth:', error);
        }
    }

    async logout() {
        try {
            const response = await $.post('/api/logout');
            if (response.success) {
                alert('Logged out successfully.');
                location.reload();
            } else {
                alert('Failed to log out.');
            }
        } catch (error) {
            console.error('Error logging out:', error);
        }
    }

    
    setConnectedEmail(email) {
        this.userEmail = email;
        $('#connectedEmail').text(`Connected as: ${email}`);
    }
    setupUI() {
        
        if (localStorage.name === "luan") {
            $("#readInterac").removeClass("d-none");
        }

        
        $('#depositCheck').on('change', (event) => {
            this.myReceipt.setDeposit(event.target.checked);
        });


    }

    async loadTemplates() {
        try {
            const response = await fetch('./data/eventPrompts.json');
            this.templates = await response.json();
        } catch (error) {
            console.error('Error loading templates:', error);
        }
    }
    cleanEmailContent(emailContent) {
        if (!emailContent) return '';

        return emailContent
            
            .replace(/TacoTaco Events Team\s*\(\d{3}\)\s*\d{3}-\d{4}\s*\|\s*info@eattaco\.ca\s*eattaco\.ca/g, '')
            .replace(/Founder and Director[\s\S]*?@drdinakulik/g, '')

            
            .replace(/\[https?:\/\/[^\]]+\]/g, '')
            .replace(/<(?![\w.@-]+>)[^>]+>/g, '')  

            
            .replace(/\s*Get Outlook for iOS\s*/, '')
            .replace(/\s*Learn why this is important\s*/, '')
            .replace(/\s*You don't often get email from.*?\s*/g, '')

            
            .replace(/[\t ]+/g, ' ')           
            .replace(/\n\s*\n\s*\n/g, '\n\n')  
            .replace(/^\s+|\s+$/gm, '')        
            .replace(/________________________________/g, '\n---\n') 

            
            .replace(/^[>\s>>>>>]+(?=\S)/gm, '') 

            
            .replace(/[\r\n]+/g, '\n')         
            .trim();
    }
    async sendAIRequest(endpoint, data) {
        try {
            
            if (data.includeBackground && this.backgroundInfo) {
                data.backgroundInfo = this.backgroundInfo;
            }

            const response = await $.post(endpoint, data);
            return response;
        } catch (error) {
            console.error(`Failed to send AI request to ${endpoint}:`, error);
            throw error;
        }
    }
    async generateConfirmationEmail(text, email) {
        const aiPrompt = `Write an email to confirm that the event is tomorrow and some of the key details. Also, ask if they have an updated attendance count and ask about catering choices. Be semi-formal.\n\nEvent details: ${text}\nEmail: ${email}.`;
        return await this.sendAIRequest("/api/sendAIText", { aiText: aiPrompt });
    }

    async getEventDetailsFromEmail(text, email) {

        text = this.cleanEmailContent(text)
        text = this.templates.eventPrompt + text;

        try {
            const data = await this.sendAIRequest("/api/sendAIEventInformation", { aiText: text });
            const jsonData = data
            const lastId = this.contacts.length > 0 ? this.contacts[this.contacts.length - 1].id : 0;
            jsonData.id = lastId + 1;
            this.contacts.push(jsonData);
            jsonData.name = jsonData.name || "";
            return jsonData.id;
        } catch (error) {
            console.error("Failed to get event details from email:", error);
            throw error;
        }
    }

    async summarizeEmailAI(text) {
        text = text.replace(/[-<>]/g, "").replace(/^Sent:.*$/gm, '').substring(0, 11000);
        const data = await this.sendAIRequest("/api/summarizeAI", { text: text });
        console.log(data)
        this.writeToAIResult(data.replace(/\n/g, "<br>"));
    }
    writeToAIResult(data) {
        
        data = data.replace(/\n/g, "<br>");

        
        data = data.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        const response = `
            <div class="p-2 aiChatReponse">
                <div class="flex justify-between items-center mb-2">
                    <div class="aiChatReponseContent">
                        ${data}
                    </div>
                    <button class="btn btn-ghost btn-xs btn-square maximize-ai-result tooltip" 
                            data-tip="Maximize">
                        <i class="bi bi-arrows-fullscreen"></i>
                    </button>
                </div>
                <div class="mt-2">
                    <a href="#" class="btn btn-primary sendToAiFromResult" title="Send to AI from Result">
                        <i class="bi bi-send"></i> Send to AI
                    </a>
                    <button class="btn btn-secondary copyToClipboard ml-2" 
                            title="Copy to Clipboard"
                            type="button"
                            onclick="navigator.clipboard.writeText(this.closest('.aiChatReponse').querySelector('.aiChatReponseContent').innerText).then(() => window.app.showToast('Copied to clipboard', 'success')).catch(() => window.app.showToast('Failed to copy', 'error'))">
                        <i class="bi bi-clipboard"></i> Copy
                    </button>
                </div>
            </div>
        `;
        $("#aiResult").html(response);
    }
    initializeMaximizeButtons() {
        
        $('#maximizeAiResult').on('click', (e) => {
            e.preventDefault();
            const content = $('#aiResult').html();
            $('#maximizeModalTitle').text('AI Conversation');
            $('#maximizedContent').html(content);
            document.getElementById('maximize_content_modal').showModal();
        });
        
        $('#toggleButton').off('click').on('click', (e) => {
            e.preventDefault();
            const content = $('#aiText').html();
            $('#maximizeModalTitle').text('Message');
            $('#maximizedContent').attr('contenteditable', 'true').html(content);
            document.getElementById('maximize_content_modal').showModal();

            
            $('#maximizedContent').off('input').on('input', function () {
                $('#aiText').html($(this).html());
            });
        });
    }
    toggleImportant(e) {
        
        this.emailFilters.showImportant = !this.emailFilters.showImportant;

        
        localStorage.setItem('showImportantEmails', this.emailFilters.showImportant);

        
        const $button = $(e.currentTarget);
        if (this.emailFilters.showImportant) {
            $button.html('<i class="bi bi-star-fill"></i>');
            $button.attr('data-tip', 'Show All Emails');
        } else {
            $button.html('<i class="bi bi-star"></i>');
            $button.attr('data-tip', 'Show Important Only');
        }

        
        $button.addClass('animate-press');
        setTimeout(() => $button.removeClass('animate-press'), 200);

        
        this.readGmail().catch(error => {
            console.error("Error refreshing emails:", error);
            this.showToast("Failed to refresh emails", "error");
        });
    }
    sortContacts(criteria) {
        switch (criteria) {
            case 'name':
                this.contacts.sort((a, b) => {
                    return (a.name || '').localeCompare(b.name || '');
                });
                break;

            case 'dateBooked':
                this.contacts.sort((a, b) => {
                    const dateA = new Date(a.createdAt || 0);
                    const dateB = new Date(b.createdAt || 0);
                    return dateB - dateA;
                });
                break;

            case 'eventDate':
                const now = moment().subtract(1, "day").startOf('day');

                
                const futureEvents = this.contacts.filter(contact =>
                    moment(contact.startTime).isSameOrAfter(now)
                );

                const pastEvents = this.contacts.filter(contact =>
                    moment(contact.startTime).isBefore(now)
                );

                
                futureEvents.sort((a, b) => {
                    const daysToA = moment(a.startTime).diff(now, 'days');
                    const daysToB = moment(b.startTime).diff(now, 'days');
                    return daysToA - daysToB;
                });

                
                pastEvents.sort((a, b) => {
                    const daysAgoA = moment(a.startTime).diff(now, 'days');
                    const daysAgoB = moment(b.startTime).diff(now, 'days');
                    return daysAgoB - daysAgoA; 
                });

                
                this.contacts = [...futureEvents, ...pastEvents];
                this.contacts.reverse();
                break;

            default:
                return 0;
        }

        
        this.renderContactsWithCalendarSync();
        this.showToast(`Sorted by ${criteria.replace(/([A-Z])/g, ' $1').toLowerCase()}`, 'success');
    }
    
    async summarizeEventAiHandler() {
        if (this.currentId === -1) {
            this.showToast('No contact selected.', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/events/${this.currentId}/summary`);
            if (!response.ok) {
                throw new Error(response.statusText);
            }

            const data = await response.json();
            console.log(data)
            
            const formattedResult = `${data.summary}.`;

            this.writeToAIResult(formattedResult);

            
            this.loadContact(this.currentId);

        } catch (error) {
            console.error('Error summarizing event:', error);
            this.showToast('Failed to summarize event', 'error');
            this.writeToAIResult('Failed to generate summary. Please try again.');
        }
    }

    filterContacts(searchTerm) {
        const $contacts = $('#contacts .contactCont');

        if (!searchTerm) {
            $contacts.show();
            return;
        }

        $contacts.each((_, contact) => {
            const $contact = $(contact);
            const contactData = this.contacts.find(c => c.id === parseInt($contact.data('id')));

            if (!contactData) {
                $contact.hide();
                return;
            }

            
            const searchableText = [
                contactData.name,
                contactData.email,
                contactData.phone,
                contactData.partyType,
                contactData.notes,
                moment(contactData.startTime).format('MM/DD/YYYY')
            ].filter(Boolean).join(' ').toLowerCase();

            const isMatch = searchableText.includes(searchTerm);
            $contact.toggle(isMatch);
        });

        
        const visibleContacts = $contacts.filter(':visible').length;
        const noResultsMessage = $('#noSearchResults');

        if (visibleContacts === 0) {
            if (!noResultsMessage.length) {
                $('#contacts').append(`
                    <div id="noSearchResults" class="text-center p-4 text-base-content/70">
                        No contacts found matching "${searchTerm}"
                    </div>
                `);
            }
        } else {
            noResultsMessage.remove();
        }
    }
    registerEvents() {
        let me = this;
        $('#getInterac').on('click', (e) => {
            e.preventDefault();
            this.getInteracEmails();
        });
        $(document).on("click", "#generateDeposit", (e) => {
            e.preventDefault();
            this.generateDeposit();
        });
        $(document).on('click', '.updateEventInfo', async (e) => {
            e.preventDefault();
            const $emailContainer = $(e.target).closest('.sms');
            const emailContent = $emailContainer.find('.email').text();
            const emailAddress = $emailContainer.attr('to');

            const button = e.target.closest('.updateEventInfo');
            const originalHtml = button.innerHTML;
            button.innerHTML = '<i class="bi bi-hourglass-split animate-spin"></i>';

            try {
                await this.emailEventUpdater.updateEventFromEmail(emailContent, emailAddress);
            } finally {
                button.innerHTML = originalHtml;
            }
        });
        $(document).on("click", "#summarizeEvent", async (e) => {
            e.preventDefault();
            await this.summarizeEventAiHandler();
        });
        
        $('#sortByName').on('click', (e) => {
            e.preventDefault();
            this.sortContacts('name');
        });

        $('#sortByDateBooked').on('click', (e) => {
            e.preventDefault();
            this.sortContacts('dateBooked');
        });

        $('#sortByEventDate').on('click', (e) => {
            e.preventDefault();
            this.sortContacts('eventDate');
        });

        
        $('#searchInput').on('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            this.filterContacts(searchTerm);
        });
        $('#clearAiText').on('click', (e) => {
            e.preventDefault();
            $("#aiText").html('');
            this.showToast("Message cleared", "success");
        });
        $("#receipt").on("click", (e) => {
            e.preventDefault();
            this.showReceiptManager();
        });
        $('#refreshCalendarSync').on('click', (e) => {
            e.preventDefault();
            this.refreshCalendarSync();
        });

        $('#toggleRepliedEmails').off('click').on('click', (e) => {
            e.preventDefault();
            this.toggleImportant(e);
        });
        $(document).on("click", "#actionsEmailContract", (e) => {
            e.preventDefault();
            this.actionsEmailContract();
        });

        $(document).on("click", ".copyToClipboard", (e) => {
            e.preventDefault();
            const container = $(e.currentTarget).closest('.aiChatReponse').find('.aiChatReponseContent');

            
            let content = container.html()
                .replace(/<br\s*\/?>/gi, '\n')  
                .replace(/<\/p>\s*<p>/gi, '\n\n')  
                .replace(/<\/div>\s*<div>/gi, '\n')  
                .replace(/<[^>]*>/g, ''); 

            
            content = $('<textarea>').html(content).text();

            
            content = content.replace(/^\s+|\s+$/g, '')  
                .replace(/[\t ]+\n/g, '\n')  
                .replace(/\n[\t ]+/g, '\n')  
                .replace(/\n\n\n+/g, '\n\n'); 

            navigator.clipboard.writeText(content)
                .then(() => {
                    this.showToast("Copied to clipboard", "success");
                })
                .catch(err => {
                    console.error('Failed to copy:', err);
                    this.showToast("Failed to copy to clipboard", "error");
                });
        });
        $(document).on("click", "#confirmAI", (e) => {
            e.preventDefault();
            this.appendConfirmationPrompt();
        });

        document.getElementById('aiText').addEventListener('paste', (e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
        });
        $(document).on("click", "#actionSendAI", async function (e) {
            e.preventDefault();
            const val = $("#aiText").text() + `\n\nBe concise and semi-formal in the response.`;
            let result = await me.sendAIRequest("/ai/chat", { message: val });
            console.log(result)

            me.writeToAIResult(result.response);

        });

        $(document).on("click", ".sms ", (e) => {
            e.preventDefault();

        });
        $(document).on("click", "#emailAI", (e) => {
            e.preventDefault();
            const val = $("#aiText").text();
            this.emailProcessor.handleDraftEventEmail(val, "");
        });

        $(document).on("click", ".generateConfirmationEmail", async (e) => {
            e.preventDefault();
            const parent = $(e.target).closest(".sms");
            const text = parent.find(".email").text();
            const email = parent.attr("to");
            $("#sendMailEmail").val(email);
            $("#sendEmail").attr("subject", "Confirmation of Event");
            await this.sendConfirmEmail(text, email);
        });

        $(document).on("click", ".getEventDetails", async (e) => {
            e.preventDefault();
            const text = $(e.target).closest(".sms").find(".email").text();
            const email = $(e.target).closest(".sms").attr("to");
            await this.handleGetEventDetailsFromEvent(text, email);
        });

        $(document).on("click", "#eventAI", async (e) => {
            e.preventDefault();
            const { match, aiText } = this.extractEmail();
            const text = match ? match[1].trim() : aiText.replace(/<br>/g, "\n");
            const email = $("#sendMailEmail").val();
            await this.handleGetEventDetailsFromEvent(text, email);
        });

        
        $(document).on("click", "#actionsBookCalendar", (e) => {
            e.preventDefault();
            this.createBooking();
        });

        $(document).on("click", "#actionsCreateContract", (e) => {
            e.preventDefault();
            this.createContract();
        });

        $(document).on("click", "#infoSave", (e) => {
            e.preventDefault();
            this.saveContactInfo();
        });

        $(document).on("click", "#readAllEmails", (e) => {
            e.preventDefault();
            this.readGmail("all");
        });




        
        $('#googleOAuthButton').on('click', () => {
            this.initiateGoogleOAuth();
        });

        
        $('#logoutButton').on('click', () => {
            this.logout();
        });
        
        
        $(document).on("click", "#sendEmail", (e) => {
            e.preventDefault();
            this.sendEmail();
        });

        $(document).on("click", "#calcRate", (e) => {
            e.preventDefault();
            this.calculateRate();
        });

        $(document).on("click", ".contactBtn", function(e)  {
            e.preventDefault();
            $('html, body').animate({ scrollTop: $('#info').offset().top }, 500);
            me.loadContact($(this).parent().data("id"));
        });

        $(document).on("click", ".sendToAiFromResult", (e) => {
            e.preventDefault();
            this.sendToAiFromResult(e);
        });

        $(document).off('click', '.toggle-button').on('click', '.toggle-button', (e) => {
            e.preventDefault();
            const $button = $(e.currentTarget);
            const $email = $button.closest('.sms').find('.email');
            const $icon = $button.find('i');

            $email.toggleClass('expanded');

            if ($email.hasClass('expanded')) {
                $icon.removeClass('bi-chevron-down').addClass('bi-chevron-up');
            } else {
                $icon.removeClass('bi-chevron-up').addClass('bi-chevron-down');
            }
        });
        $('#searchInput').on('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            $('#contacts .contactCont').each((index, contactElement) => {
                const contactName = $(contactElement).find('.contactBtn').text().toLowerCase();
                $(contactElement).toggle(contactName.includes(searchTerm));
            });
        });
        
    }


    

    ensureArrayFields(contact) {
        ['status', 'services', 'room'].forEach(field => {
            if (!Array.isArray(contact[field])) {
                if (typeof contact[field] === 'string') {
                    contact[field] = contact[field].split(';');
                } else {
                    contact[field] = [];
                }
            }
        });
    }

    extractEmail() {
        const aiText = $("#aiText").text();
        const regex = /From:.*?([\s\S]*?)(?=From:|$)/;
        const match = regex.exec(aiText);
        return { match, aiText };
    }

    appendConfirmationPrompt() {
        $("#aiText").prepend("Write an email to confirm that the event is tomorrow and some of the key details. Also, ask if they have an updated attendance count and ask about catering choices. Be semi-formal.");
    }


    async handleGetEventDetailsFromEvent(text, email) {
        const newId = await this.getEventDetailsFromEmail(text, email);
        this.loadContact(newId);
    }

    async sendConfirmEmail(text, email) {
        $("#aiText").append(`---------------------<br><br>${text.replace(/\n/g, "<br>")}`);
        try {
            let data = await this.generateConfirmationEmail(text, email);
            data = data.replace(/```/g, "").replace(/html/g, "").replace(/\n/g, "<br>");
            $("#aiText").prepend(data + "<br><br>");
            this.utils.alert("Confirmation email generated and displayed.");
        } catch (error) {
            this.utils.alert("Failed to generate confirmation email: " + error);
        }
    }
    async sendEmail() {
        try {
            const content = $("#aiText").html();
            const to = $("#sendMailEmail").val();
            const subject = $("#sendMailSubject").val();
            const replyToMessageId = $("#aiText").data('replyToMessageId');
            const source = $("#aiText").data('source');

            if (!content || !to || !subject) {
                this.showToast("Please fill in all required fields", "error");
                return;
            }

            if (!confirm("Are you sure you want to send this email?")) {
                return;
            }

            
            const emailData = {
                html: content,
                to: to,
                subject: subject,
                replyToMessageId: replyToMessageId,
                source: source
            };

            const response = await $.post("/gmail/sendEmail", emailData);

            if (response.success) {
                this.showToast("Email sent successfully", "success");

                
                $("#aiText").html('');
                $("#sendMailEmail").val('');
                $("#sendMailSubject").val('');
                $("#aiText").removeData('replyToMessageId');
                $("#aiText").removeData('source');

                
                if (this.sounds?.orderUp) {
                    this.sounds.orderUp.play();
                }

                
                if (replyToMessageId) {
                    await this.readGmail();
                }

                
                if (replyToMessageId) {
                    $(`.sms[data-id="${replyToMessageId}"]`).addClass('replied');
                    const $replyIcon = $(`.sms[data-id="${replyToMessageId}"] .icon-btn[data-tip="Replied"]`);
                    if (!$replyIcon.length) {
                        const iconHtml = `
                            <button class="icon-btn tooltip" data-tip="Replied">
                                <i class="bi bi-reply-fill text-success"></i>
                            </button>
                        `;
                        $(`.sms[data-id="${replyToMessageId}"] .flex.gap-2`).append(iconHtml);
                    }
                }
            } else {
                throw new Error(response.error || 'Failed to send email');
            }
        } catch (error) {
            console.error("Failed to send email:", error);
            this.showToast("Failed to send email: " + error.message, "error");
        }
    }


    calculateRate() {
        const timezone = 'America/New_York';
        const eventDate = {
            start: moment.tz($("#infoStartTime").val(), "YYYY-MM-DD HH:mm", timezone),
            end: moment.tz($("#infoEndTime").val(), "YYYY-MM-DD HH:mm", timezone)
        };
        const hours = moment.duration(eventDate.end.diff(eventDate.start)).asHours();
        const rate = hours * parseFloat($("#hourlyRate").val());
        $("#infoRentalRate").val(rate);
    }

    sendToAiFromResult(e) {
        $("#aiText").html("");
        let text = $(e.target).closest(".aiChatReponse").find(".aiChatReponseContent").html();
        text = text.replace(/<button.*<\/button>/, "");
        $("#aiText").html(`<br><br>${text}`);
        $('html, body').animate({ scrollTop: $("#aiText").offset().top }, 500);
        $("#aiText").focus();
    }
    async readGmail(email = null, options = {}) {
        this.adjustMessagesContainerHeight();
        $(".messages-container").html(`
            <div class="alert alert-info">
                <i class="bi bi-hourglass-split"></i>
                Loading emails...
            </div>
        `);

        try {
            let response;
            if (email) {
                
                response = await $.get("/gmail/readGmail", {
                    email: email,
                    type: 'contact',
                    orderBy: 'timestamp',
                    order: 'desc'
                });
            } else {
                
                const type = $('#messages').data('currentView') === 'interac' ? 'interac' : 'all';
                response = await $.get("/gmail/readGmail", {
                    type: type,
                    forceRefresh: false,
                    orderBy: 'timestamp',
                    order: 'desc',
                    showImportant: this.emailFilters.showImportant 
                });
            }

            if (!Array.isArray(response)) {
                throw new Error("Invalid response format");
            }

            if ($('#messages').data('currentView') === 'interac') {
                this.processInteracEmails(response);
            } else {
                
                this.processEmails(response, options);
            }

            return response;
        } catch (error) {
            console.error("Failed to read Gmail:", error);
            $(".messages-container").html(`
                <div class="alert alert-error">
                    <i class="bi bi-exclamation-triangle"></i>
                    Failed to load emails: ${error.message || 'Unknown error'}
                </div>
            `);
            throw error;
        }
    }
    async refreshCalendarSync() {
        try {
            await this.createCalendar();
            this.showToast("Calendar sync refreshed", "success");
        } catch (error) {
            console.error('Error refreshing calendar sync:', error);
            this.showToast("Failed to refresh calendar sync", "error");
        }
    }
    refreshEmails() {
        const messagesContainer = $("#messages .messages-container");
        const loadingHtml = `
            <div class="alert alert-info">
                <i class="bi bi-hourglass-split"></i>
                Filtering emails...
            </div>
        `;
        messagesContainer.html(loadingHtml);

        
        $.get("/gmail/readGmail", {
            email: 'all',
            showCount: 25
        }).then(response => {
            this.processEmails(response);
        }).catch(error => {
            console.error("Failed to refresh emails:", error);
            messagesContainer.html(`
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle"></i>
                    Failed to refresh emails: ${error.message || 'Unknown error'}
                </div>
            `);
        });
    }
    initializeEmailToggles() {
        $(document).off('click', '.toggle-button').on('click', '.toggle-button', (e) => {
            e.preventDefault();
            const $button = $(e.currentTarget);
            const $email = $button.closest('.sms').find('.email');
            const $icon = $button.find('i');

            $email.toggleClass('expanded');

            if ($email.hasClass('expanded')) {
                $icon.removeClass('bi-chevron-down').addClass('bi-chevron-up');
            } else {
                $icon.removeClass('bi-chevron-up').addClass('bi-chevron-down');
            }
        });
    }
    processEmails(data, options = {}) {
        if (!Array.isArray(data)) {
            console.error("Invalid data format:", data);
            return;
        }

        
        let filteredEmails = data;
        if (!options.ignoreFilters) {
            filteredEmails = data.filter(email => {
                
                if (email.labels && email.labels.includes('Label_6')) {
                    return false;
                }

                
                if (email.replied) {
                    return false;
                }

                
                if (this.emailFilters.showImportant) {
                    return (
                        (email.category === 'event') ||
                        (email.labels && email.labels.includes('IMPORTANT'))
                    );
                }

                return true;
            });
        }

        
        filteredEmails.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const exclusionArray = ["calendar-notification", "accepted this invitation", "peerspace", "tagvenue"];
        let html = '';

        filteredEmails.forEach((email) => {
            if (!email || !email.subject) {
                console.warn("Skipping invalid email entry:", email);
                return;
            }

            
            let emailContent = '';
            if (email.text) {
                emailContent = email.text
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n')
                    .replace(/\n{3,}/g, '\n\n')
                    .replace(/\n/g, '<br>');
            } else if (email.html) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = email.html;

                const scripts = tempDiv.getElementsByTagName('script');
                const styles = tempDiv.getElementsByTagName('style');
                for (let i = scripts.length - 1; i >= 0; i--) scripts[i].remove();
                for (let i = styles.length - 1; i >= 0; i--) styles[i].remove();

                emailContent = tempDiv.innerHTML
                    .replace(/<div[^>]*>/gi, '')
                    .replace(/<\/div>/gi, '<br>')
                    .replace(/<p[^>]*>/gi, '')
                    .replace(/<\/p>/gi, '<br><br>')
                    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '<br><br>')
                    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
            } else {
                console.warn("Email has no content:", email);
                return;
            }

            
            if (exclusionArray.some((exclusion) =>
                email.subject.toLowerCase().includes(exclusion) ||
                emailContent.toLowerCase().includes(exclusion)
            )) {
                return;
            }

            const emailAddressMatch = email.from.match(/<([^>]+)>/);
            const emailAddress = emailAddressMatch ? emailAddressMatch[1] : email.from;

            const isUnread = email.labels && email.labels.includes("UNREAD");
            const isImportant = email.labels && email.labels.includes("IMPORTANT");

            const unreadIcon = isUnread
                ? `<button class="icon-btn tooltip" data-tip="Unread"><i class="bi bi-envelope-open-text text-warning"></i></button>`
                : `<button class="icon-btn tooltip" data-tip="Read"><i class="bi bi-envelope text-secondary"></i></button>`;

            const importantIcon = isImportant
                ? `<button class="icon-btn tooltip" data-tip="Important"><i class="bi bi-star-fill text-warning"></i></button>`
                : '';

            const replyIcon = email.replied
                ? `<button class="icon-btn tooltip" data-tip="Replied">
                     <i class="bi bi-reply-fill text-success"></i>
                   </button>`
                : '';

            const timestamp = moment.tz(email.timestamp, 'America/New_York');
            const timeDisplay = timestamp.format("MM/DD/YYYY HH:mm");
            const timeAgo = timestamp.fromNow();

            html += `
                <div class="sms ${email.replied ? 'replied' : ''}" 
                     subject="${_.escape(email.subject)}" 
                     to="${_.escape(emailAddress)}" 
                     data-id="${_.escape(email.id)}">
                    <div class="flex items-center justify-between mb-2">
                        <button class="icon-btn toggle-button tooltip" data-tip="Toggle Content">
                            <i class="bi bi-chevron-down"></i>
                        </button>
                        <div class="flex gap-2">
                            ${unreadIcon}
                            ${importantIcon}
                            ${replyIcon}
                        </div>
                    </div>
                    
                    <div class="email collapsed">
                        <div class="email-header text-sm space-y-1">
                            <div><strong>From:</strong> ${_.escape(email.from)}</div>
                            <div><strong>To:</strong> ${_.escape(email.to)}</div>
                            <div><strong>Subject:</strong> ${_.escape(email.subject)}</div>
                            <div><strong>Time:</strong> ${timeDisplay} (${timeAgo})</div>
                        </div>
                        <div class="email-body mt-3">
                            ${emailContent}
                        </div>
                    </div>
    
                    <div class="action-buttons flex flex-wrap gap-2 mt-2">
                        <button class="icon-btn summarizeEmailAI tooltip tooltip-top" data-tip="Summarize Email">
                            <i class="bi bi-list-task"></i>
                        </button>
                        <button class="icon-btn draftEventSpecificEmail tooltip tooltip-top" data-tip="Draft Event Email">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="icon-btn getEventDetails tooltip tooltip-top" data-id="${_.escape(email.id)}" data-tip="Get Event Information">
                            <i class="bi bi-calendar-plus"></i>
                        </button>
                        <button class="icon-btn generateConfirmationEmail tooltip tooltip-top" data-id="${_.escape(email.id)}" data-tip="Generate Confirmation">
                            <i class="bi bi-envelope"></i>
                        </button>
                        <button class="icon-btn sendToAiTextArea tooltip tooltip-top" subject="${_.escape(email.subject)}" to="${_.escape(emailAddress)}" data-id="${_.escape(email.id)}" data-tip="Send to AI">
                            <i class="bi bi-send"></i>
                        </button>
                        <button class="icon-btn archiveEmail tooltip tooltip-top" data-tip="Archive Email">
                            <i class="bi bi-archive"></i>
                        </button>
                        <button class="icon-btn updateEventInfo tooltip tooltip-top" data-tip="Update Event Info">
                            <i class="bi bi-arrow-up-circle"></i>
                        </button>
                    </div>
                </div>`;
        });

        if (html) {
            $(".messages-container").html(html);
            this.initializeEmailToggles();
        } else {
            $(".messages-container").html(`
                <div class="alert alert-info">
                    <i class="bi bi-info-circle"></i>
                    No emails found
                </div>
            `);
        }
    }
    initializeTooltips() {
        
        $('.icon-btn[data-tooltip]').tooltip('dispose');

        
        $('.icon-btn').tooltip({
            placement: 'top',
            trigger: 'hover'
        });
    }

    


    
    async getAllContacts() {
        fetch("/api/events")
            .then(response => response.json())
            .then(contacts => {
                
                this.contacts = contacts.map(contact => ({
                    ...contact,
                    createdAt: contact.createdAt || new Date().toISOString()
                }));
                return this.contacts;
                
            })
            .catch(error => {
                console.error("Error getting contacts:", error);
                this.showToast('Failed to load contacts', 'error');
            });
    }
    async createCalendar() {
        this.mainCalendar = new Calendar('calendar');
        try {
            const data = await $.get("/calendar/getEventCalendar");
            const timezone = 'America/New_York';

            
            const contactsByDate = {};
            this.contacts.forEach(contact => {
                if (contact.startTime && contact.name) {
                    const contactDate = moment.tz(contact.startTime, timezone).format('YYYY-MM-DD');
                    if (!contactsByDate[contactDate]) {
                        contactsByDate[contactDate] = [];
                    }
                    contactsByDate[contactDate].push({
                        name: contact.name.toLowerCase(),
                        attendance: contact.attendance
                    });
                }
            });

            
            this.calendarEvents = data.map((event, index) => {
                const startTime = moment.tz(event.start.dateTime || event.start.date, timezone);
                const endTime = moment.tz(event.end.dateTime || event.end.date, timezone);
                const eventDate = startTime.format('YYYY-MM-DD');
                const eventName = event.summary.toLowerCase();

                
                let matchingContact = null;
                const contactsOnDate = contactsByDate[eventDate] || [];
                for (const contact of contactsOnDate) {
                    if (eventName.includes(contact.name)) {
                        matchingContact = contact;
                        break;
                    }
                }

                
                const attendanceInfo = matchingContact?.attendance ? ` (${matchingContact.attendance} ppl)` : '';
                event.summary = `${event.summary} <br>${startTime.format("HHmm")}-${endTime.format("HHmm")}${attendanceInfo}`;

                let calendarEnd = endTime.clone();
                if (endTime.isAfter(startTime.clone().hour(23).minute(59))) {
                    calendarEnd = startTime.clone().hour(23).minute(59);
                }

                return {
                    id: index,
                    title: event.summary || 'No Title',
                    startTime: startTime.format(),
                    endTime: calendarEnd.format(),
                    description: event.description || '',
                    room: event.location || '',
                    attendance: matchingContact?.attendance
                };
            });

            
            this.mainCalendar.loadEvents(this.calendarEvents);

            
            if (this.contacts.length > 0) {
                this.renderContactsWithCalendarSync();
            }

        } catch (error) {
            console.error('Error loading calendar events:', error);
            this.showToast('Failed to load calendar events', 'error');
        }
    }

    renderContactsWithCalendarSync() {
        
        const eventsByDate = {};
        this.calendarEvents.forEach(event => {
            if (!event?.startTime) return;
            const eventDate = moment.tz(event.startTime, 'America/New_York').format('YYYY-MM-DD');
            if (!eventsByDate[eventDate]) {
                eventsByDate[eventDate] = [];
            }
            event.summary = event.summary || '';
            eventsByDate[eventDate].push(event);
        });

        
        let html = '';
        const statusUpdates = []; 

        this.contacts.slice().reverse().forEach(contact => {
            if (!contact || !contact.startTime || !contact.name) return;

            const contactDate = moment.tz(contact.startTime, 'America/New_York');
            const formattedDate = contactDate.format("MM/DD/YYYY");
            const lookupDate = contactDate.format('YYYY-MM-DD');
            const contactFirstWord = contact.name.toLowerCase().split(' ')[0];

            let colour = "blue";
            let statusIcons = '';
            let hasCalendarEntry = false;

            
            const eventsOnDate = eventsByDate[lookupDate] || [];
            if (eventsOnDate.length > 0) {
                hasCalendarEntry = eventsOnDate.some(event => {
                    const eventTitle = event.title || '';
                    const eventFirstWord = eventTitle.toLowerCase().split(' ')[0];
                    return eventFirstWord === contactFirstWord;
                });
            }

            
            let statusArray = [];
            if (typeof contact.status === 'string') {
                statusArray = [...new Set(contact.status.split(';').filter(s => s))]; 
            } else if (Array.isArray(contact.status)) {
                statusArray = [...new Set(contact.status.filter(s => s))]; 
            }

            
            if (hasCalendarEntry) {
                statusIcons += '<i class="bi bi-calendar-check-fill text-success ml-2"></i>';

                
                if (!statusArray.includes("reserved")) {
                    statusArray.push("reserved");
                    
                    statusUpdates.push({
                        id: contact.id,
                        contact: {
                            ...contact,
                            status: statusArray 
                        }
                    });
                }
            } else {
                
                if (statusArray.includes("depositPaid")) {
                    statusIcons += '<i class="bi bi-cash text-success ml-2"></i>';
                }
                if (statusArray.includes("reserved")) {
                    statusIcons += '<i class="bi bi-bookmark-check text-primary ml-2"></i>';
                }
            }

            if (contactDate.isBefore(moment().subtract(2, "days"))) {
                colour = "lightgrey";
            }

            html += `
                <div class="contactCont hover:bg-base-200 transition-colors" 
                     data-id="${_.escape(contact.id)}" 
                     data-date="${_.escape(formattedDate)}">
                    <a href="#" class="contactBtn flex items-center justify-between p-2" 
                       style="color:${_.escape(colour)};" 
                       data-id="${_.escape(contact.id)}">
                        <span class="flex-1">
                            ${_.escape(contact.name)} (${_.escape(formattedDate)})
                        </span>
                        <span class="flex items-center">${statusIcons}</span>
                    </a>
                </div>`;
        });

        
        $("#contacts").empty().append(html);

        
        if (statusUpdates.length > 0) {
            this.updateContactStatuses(statusUpdates);
        }
    }
    async updateContactStatuses(updates) {
        for (const update of updates) {
            try {
                
                const services = Array.isArray(update.contact.services)
                    ? update.contact.services.join(';')
                    : update.contact.services;

                const room = Array.isArray(update.contact.room)
                    ? update.contact.room.join(';')
                    : update.contact.room;

                
                const status = Array.isArray(update.contact.status)
                    ? [...new Set(update.contact.status)].join(';')
                    : [...new Set(update.contact.status.split(';').filter(s => s))].join(';');

                const response = await fetch(`/api/events/${update.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        name: update.contact.name,
                        email: update.contact.email,
                        startTime: update.contact.startTime,
                        endTime: update.contact.endTime,
                        status: status,
                        services: services,
                        room: room,
                        phone: update.contact.phone,
                        notes: update.contact.notes,
                        rentalRate: update.contact.rentalRate,
                        minSpend: update.contact.minSpend,
                        partyType: update.contact.partyType,
                        attendance: update.contact.attendance
                    })
                });

                if (!response.ok) {
                    console.error(`Failed to update status for contact ${update.id}:`, await response.text());
                } else {
                    
                    const contact = this.contacts.find(c => c.id === update.id);
                    if (contact) {
                        contact.status = status; 
                    }
                    console.log(`Successfully updated status for contact ${update.id}`);
                }
            } catch (error) {
                console.error(`Error updating contact ${update.id} status:`, error);
            }
        }
    }

    loadContact(id) {
        const contact = _.find(this.contacts, ["id", id]);
        if (!contact) {
            this.currentId = this.contacts.length;
            return;
        }
        this.currentId = contact.id;
        this.ensureArrayFields(contact);

        
        $("#infoId").val(contact.id);
        $("#infoName").val(contact.name || "");
        $("#infoEmail").val(contact.email || "");
        $("#infoStartTime").val(moment.tz(contact.startTime, 'America/New_York').format("YYYY-MM-DD HH:mm"));
        $("#infoEndTime").val(moment.tz(contact.endTime, 'America/New_York').format("YYYY-MM-DD HH:mm"));

        
        const $statusSelect = $("#infoStatus");
        $statusSelect.val([]);  
        if (contact.status) {
            const statusArray = Array.isArray(contact.status) ?
                contact.status : contact.status.split(';').filter(s => s);
            $statusSelect.val(statusArray);
        }

        const $roomSelect = $("#infoRoom");
        $roomSelect.val([]);
        if (contact.room) {
            const roomArray = Array.isArray(contact.room) ?
                contact.room : contact.room.split(';').filter(s => s);
            $roomSelect.val(roomArray);
        }

        const $servicesSelect = $("#infoServices");
        $servicesSelect.val([]);
        if (contact.services) {
            const servicesArray = Array.isArray(contact.services) ?
                contact.services : contact.services.split(';').filter(s => s);
            $servicesSelect.val(servicesArray);
        }

        $("#actionsPhone").val(contact.phone || "");
        $("#infoNotes").val(contact.notes || "");
        $("#infoRentalRate").val(contact.rentalRate || "");
        $("#infoMinSpend").val(contact.minSpend || "");
        $("#infoPartyType").val(contact.partyType || "");
        $("#infoAttendance").val(contact.attendance || "");

        if (contact.email) {
            
            this.readGmail(contact.email, {
                showAll: true,
                ignoreFilters: true
            });
        }
        $("#depositPw").html(this.calcDepositPassword(contact));
    }

    calcDepositPassword(contact) {
        return moment.tz(contact.startTime, 'America/New_York').format("MMMMDD");
    }
    async initializeBackgroundInfo() {
        try {
            
            const backgroundResponse = await fetch('/api/settings/background');
            const backgroundData = await backgroundResponse.json();
            $('#backgroundInfo').val(backgroundData.backgroundInfo || '');

            
            const categoriesResponse = await fetch('/api/settings/email-categories');
            const data = await categoriesResponse.json();

            if (!data.emailCategories || !Array.isArray(data.emailCategories)) {
                throw new Error('Invalid email categories format');
            }

            
            const categoryRows = data.emailCategories.map((category, index) => `
                <tr>
                    <td>
                        <input type="text" 
                               id="emailCategoryName-${index}" 
                               class="input input-bordered w-full" 
                               value="${_.escape(category.name)}" />
                    </td>
                    <td>
                        <input type="text" 
                               id="emailCategoryDescription-${index}" 
                               class="input input-bordered w-full" 
                               value="${_.escape(category.description)}" />
                    </td>
                    <td>
                        <button class="btn btn-square btn-sm btn-error delete-category" data-index="${index}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>
            `).join('');

            $('#emailCategoryTable tbody').html(categoryRows);

            
            $(document).off('click', '.delete-category').on('click', '.delete-category', function () {
                $(this).closest('tr').remove();
            });

            $('#addEmailCategory').off('click').on('click', () => {
                const newRow = `
                    <tr>
                        <td>
                            <input type="text" 
                                   id="emailCategoryName-${$('#emailCategoryTable tbody tr').length}" 
                                   class="input input-bordered w-full" 
                                   placeholder="Category Name" />
                        </td>
                        <td>
                            <input type="text" 
                                   id="emailCategoryDescription-${$('#emailCategoryTable tbody tr').length}" 
                                   class="input input-bordered w-full" 
                                   placeholder="Category Description" />
                        </td>
                        <td>
                            <button class="btn btn-square btn-sm btn-error delete-category">
                                <i class="bi bi-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
                $('#emailCategoryTable tbody').append(newRow);
            });

            $('#saveBackgroundInfo').off('click').on('click', async () => {
                try {
                    
                    const backgroundInfo = $('#backgroundInfo').val();
                    await fetch('/api/settings/background', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ backgroundInfo })
                    });

                    
                    const emailCategories = [];
                    $('#emailCategoryTable tbody tr').each((index, row) => {
                        const name = $(`#emailCategoryName-${index}`, row).val().trim();
                        const description = $(`#emailCategoryDescription-${index}`, row).val().trim();
                        if (name !== '') {
                            emailCategories.push({ name, description });
                        }
                    });

                    await this.emailProcessor.userSettings.saveSettings({ emailCategories });
                    this.showToast('Settings saved successfully', 'success');
                } catch (error) {
                    console.error('Error saving settings:', error);
                    this.showToast('Failed to save settings', 'error');
                }
            });
        } catch (error) {
            console.error('Failed to load background info:', error);
            this.showToast('Failed to load background info', 'error');
        }
    }
    populateBackgroundFields() {
        
        $('#venueName').val(this.backgroundInfo.venueName || '');
        $('#venueAddress').val(this.backgroundInfo.address || '');
        $('#venueCapacity').val(this.backgroundInfo.capacity || '');
        $('#venueFacilities').val(this.backgroundInfo.facilities || '');
        $('#venueServices').val(this.backgroundInfo.services || '');
        $('#venuePolicies').val(this.backgroundInfo.policies || '');
        $('#venuePricing').val(this.backgroundInfo.pricing || '');
        $('#venueNotes').val(this.backgroundInfo.specialNotes || '');
    }
    async saveBackgroundInfo() {
        
        const backgroundInfo = $('#backgroundInfo').val();

        try {
            const response = await fetch('/api/settings/background', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ backgroundInfo })  
            });

            if (response.ok) {
                this.backgroundInfo = backgroundInfo;
                this.showSaveStatus('success');
            } else {
                this.showSaveStatus('error');
            }
        } catch (error) {
            console.error('Failed to save background info:', error);
            this.showSaveStatus('error');
        }
    }

    showSaveStatus(status) {
        const $saveStatus = $('#saveStatus');
        $saveStatus.removeClass('hidden alert-success alert-error');

        if (status === 'success') {
            $saveStatus.addClass('alert-success').text('Settings saved successfully!');
        } else {
            $saveStatus.addClass('alert-error').text('Failed to save settings. Please try again.');
        }

        
        setTimeout(() => {
            $saveStatus.addClass('hidden');
        }, 3000);
    }
    
    async initializeFuse() {
        if (this.contacts.length > 0) {
            this.fuse = new Fuse(this.contacts, {
                keys: ['name'],
                threshold: 0.3
            });
        }
    }
    processInteracEmails(data) {
        if (!Array.isArray(data)) {
            console.error("Invalid data format:", data);
            return;
        }

        let html = '';
        data.forEach((email) => {
            
            const emailContent = email.text || email.html;
            const nameMatch = emailContent.match(/Sent From:\s*(.*?)(?:\n|$)/);
            const amountMatch = emailContent.match(/Amount:\s*\$([\d.]+)/);

            const senderName = nameMatch ? nameMatch[1].trim() : 'Unknown';
            const amount = amountMatch ? amountMatch[1] : '0.00';

            
            const timestamp = moment.tz(email.timestamp, 'America/New_York');
            const timeDisplay = timestamp.format("MM/DD/YYYY HH:mm");
            const timeAgo = timestamp.fromNow();

            
            let matchingContactsHtml = '';
            if (this.fuse) {
                const matches = this.fuse.search(senderName);
                const contact = matches.length > 0 ? matches[0].item : null;
                if (contact) {
                    const depositPw = this.calcDepositPassword(contact);
                    matchingContactsHtml = `
                    <div class="alert alert-success mt-2">
                        <i class="bi bi-check-circle"></i> 
                        Matching contact: ${contact.name}<br>
                        Deposit Password: ${depositPw}
                    </div>
                `;
                }
            }

            html += `
            <div class="sms" data-id="${email.id}" data-name="${_.escape(senderName)}" data-amount="${amount}">
                <div class="flex items-center justify-between mb-2">
                    <div class="text-xl font-bold text-success">
                        $${_.escape(amount)}
                    </div>
                    <div>
                        <button class="btn btn-primary btn-sm forward-etransfer gap-2">
                            <i class="bi bi-forward"></i>
                            Forward eTransfer
                        </button>
                    </div>
                </div>

                <div class="email-header text-sm space-y-1">
                    <div><strong>From:</strong> ${_.escape(email.from)}</div>
                    <div><strong>Sent From:</strong> ${_.escape(senderName)}</div>
                    <div><strong>Time:</strong> ${timeDisplay} (${timeAgo})</div>
                    ${matchingContactsHtml}
                </div>

                <div class="email mt-4">
                    ${emailContent.replace(/\n/g, '<br>')}
                </div>
            </div>
        `;
        });

        if (html) {
            $(".messages-container").html(html);
            this.initializeForwardButtons();
        } else {
            $(".messages-container").html(`
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i>
                No Interac e-Transfer emails found
            </div>
        `);
        }
    }
    initializeForwardButtons() {
        $('.forward-etransfer').off('click').on('click', async (e) => {
            const $container = $(e.target).closest('.sms');
            const senderName = $container.data('name');
            const amount = $container.data('amount');
            const emailId = $container.data('id');

            try {
                const staffResponse = await $.get('https:
                const activeStaff = staffResponse.filter(staff => staff.active);
                const matches = this.fuse ? this.fuse.search(senderName) : [];

                const modal = document.getElementById('etransfer_modal') || document.createElement('dialog');
                modal.id = 'etransfer_modal';
                modal.className = 'modal';

                modal.innerHTML = `
                <div class="modal-box">
                    <h3 class="font-bold text-lg">Forward eTransfer</h3>
                    <div class="py-4 space-y-4">
                        <div class="alert alert-info">
                            <div class="text-lg">$${amount} from ${senderName}</div>
                        </div>

                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">Select Matching Contact</span>
                            </label>
                            <select class="select select-bordered" id="matchingContacts">
                                <option value="">Select contact...</option>
                                ${matches.map(match => {
                    const depositPw = this.calcDepositPassword(match.item);
                    return `
                                        <option value="${match.item.id}" 
                                                data-password="${depositPw}">
                                            ${match.item.name} (${moment(match.item.startTime).format('MM/DD/YYYY')})
                                        </option>
                                    `;
                }).join('')}
                            </select>
                        </div>

                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">Forward To Staff</span>
                            </label>
                            <select class="select select-bordered" id="sendStaffSelect">
                                <option value="">Select staff member...</option>
                                ${activeStaff.map(staff => `
                                    <option value="${staff.email}" 
                                            data-phone="${staff.phone}">
                                        ${staff.user}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="modal-action">
                        <button class="btn btn-primary" id="sendEtransfer">Send</button>
                        <button class="btn" onclick="etransfer_modal.close()">Cancel</button>
                    </div>
                </div>
            `;

                document.body.appendChild(modal);
                modal.showModal();

                $('#sendEtransfer').off('click').on('click', async () => {
                    const selectedStaff = $('#sendStaffSelect').val();
                    const selectedStaffPhone = $('#sendStaffSelect option:selected').data('phone');
                    const selectedStaffName = $('#sendStaffSelect option:selected').text();
                    const depositPw = $('#matchingContacts option:selected').data('password');

                    if (!selectedStaff || !depositPw) {
                        this.showToast('Please select both a contact and staff member', 'error');
                        return;
                    }

                    try {
                        
                        await $.post('/gmail/forwardEmail', {
                            messageId: emailId,
                            to: selectedStaff
                        });

                        
                        const smsData = {
                            to: selectedStaffPhone,
                            message: `This is Luan from TacoTaco. The PW to the etransfer for ${senderName} is ${depositPw}. Please confirm after you've deposited. If there is a problem, message Luan on Whatsapp.`,
                            fromName: 'Luan',
                            amount: amount,
                            toName: selectedStaffName
                        };

                        await $.post('https:

                        this.showToast('eTransfer forwarded and SMS sent successfully', 'success');
                        modal.close();
                    } catch (error) {
                        console.error('Error forwarding eTransfer:', error);
                        this.showToast('Error forwarding eTransfer', 'error');
                    }
                });

            } catch (error) {
                console.error('Error loading staff data:', error);
                this.showToast('Error loading staff data', 'error');
            }
        });
    }



    

    saveContactInfo() {
        let contact = _.find(this.contacts, ["id", this.currentId]);
        if (!contact) {
            
            contact = {};
        }

        
        const selectedStatus = Array.from($("#infoStatus").find("option:selected")).map(opt => opt.value);
        const selectedServices = Array.from($("#infoServices").find("option:selected")).map(opt => opt.value);
        const selectedRoom = Array.from($("#infoRoom").find("option:selected")).map(opt => opt.value);

        contact.id = parseInt(contact.id) || null;
        contact.name = $("#infoName").val();
        contact.email = $("#infoEmail").val();
        contact.phone = $("#actionsPhone").val();
        contact.startTime = $("#infoStartTime").val();
        contact.endTime = $("#infoEndTime").val();
        contact.status = selectedStatus.join(";");
        contact.services = selectedServices.join(";");
        contact.room = selectedRoom.join(";");
        contact.rentalRate = $("#infoRentalRate").val();
        contact.minSpend = $("#infoMinSpend").val();
        contact.partyType = $("#infoPartyType").val();
        contact.attendance = $("#infoAttendance").val();
        contact.notes = $("#infoNotes").val();

        
        if (contact.id) {
            
            $.ajax({
                url: `/api/events/${contact.id}`,
                type: 'PUT',
                data: JSON.stringify(contact),
                contentType: 'application/json',
                success: (response) => {
                    this.showToast("Contact updated", "success");
                    
                    const index = this.contacts.findIndex(c => c.id === contact.id);
                    if (index !== -1) {
                        this.contacts[index] = contact;
                    }
                },
                error: (xhr, status, error) => {
                    console.error("Failed to update contact:", error);
                    this.showToast("Failed to update contact", "error");
                }
            });
        } else {
            
            $.ajax({
                url: `/api/events`,
                type: 'POST',
                data: JSON.stringify(contact),
                contentType: 'application/json',
                success: (response) => {
                    
                    contact.id = response.id;
                    this.contacts.push(contact);
                    this.showToast("Contact created", "success");
                },
                error: (xhr, status, error) => {
                    console.error("Failed to create contact:", error);
                    this.showToast("Failed to create contact", "error");
                }
            });
        }
    }



    async syncEvents() {
        try {
            const response = await fetch('/api/events/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Sync failed');
            }

            
            this.showToast('Events synchronized successfully', 'success');

            
            this.getAllContacts();
        } catch (error) {
            console.error('Error syncing events:', error);
            this.showToast('Failed to sync events', 'error');
        }
    }


    async actionsEmailContract() {
        if (this.currentId === -1) {
            alert("Error: No contact selected.");
            return;
        }
        const contact = _.find(this.contacts, ["id", this.currentId]);
        if (!contact) {
            alert("Error: Contact not found.");
            return;
        }

        const date = moment(contact.startTime, "YYYY-MM-DD HH:mm").format("MM/DD/YYYY");
        const formattedPassword = moment(contact.startTime, "YYYY-MM-DD HH:mm").format("MMMMDD");

        const subject = `Event Contract ${date}`;
        const body = `Hi ${contact.name},
    
        Please see attached for the event contract. The contract has been pre-filled but if you can't see the details, please view the contract on a computer rather than a phone. Let me know if you have any questions otherwise you can simply respond to this email saying that you accept it, and attach a picture of your ID (we only need a picture of your face and your name). To fully reserve the date, please transfer the deposit to info@eattaco.ca, with the password '${formattedPassword}'.
        
        TacoTaco Events Team
        TacoTaco 
        www.eattaco.ca`;

        const mailtoLink = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

        window.location.href = mailtoLink;
    }
    async createBooking() {
        if (this.currentId === -1) {
            this.showToast("Error: No contact selected.", "error");
            return;
        }

        const contact = _.find(this.contacts, ["id", this.currentId]);
        if (!contact) {
            this.showToast("Error: Contact not found.", "error");
            return;
        }

        try {
            
            await this.openGoogleCalendar(contact);

            
            if (typeof contact.status === 'string') {
                contact.status = contact.status.split(';');
            } else if (!Array.isArray(contact.status)) {
                contact.status = [];
            }

            if (!contact.status.includes("reserved")) {
                contact.status.push("reserved");
            }

            
            await this.saveContactInfo();

            
            await this.createCalendar();

            this.showToast("Booking created successfully", "success");

            
            const sendEmail = confirm("Would you like to send a confirmation email to the event organizer?");

            if (sendEmail) {
                const eventDate = moment(contact.startTime).format('MMMM Do');
                const eventTime = `${moment(contact.startTime).format('h:mm A')} - ${moment(contact.endTime).format('h:mm A')}`;

                const emailSubject = "You're all set for " + eventDate + "";
                const emailBody = `
    Hi ${contact.name}!
    
    Great news - you're officially booked in for ${eventDate} from ${eventTime}! 
    
    We've received your contract and deposit, and I've just sent you a calendar invite. You'll have access to ${contact.room} for your event.
    
    Quick reminder: Three days before the big day, could you let us know:
    - Final guest count
    - Catering preferences (if you'd like our food & beverage service)
    
    Can't wait to help make your event amazing! Let me know if you need anything before then.
    
    Cheers,
    TacoTaco Events Team'
                `.trim();

                try {
                    await $.post("/gmail/sendEmail", {
                        html: emailBody.replace(/\n/g, '<br>'),
                        to: contact.email,
                        subject: emailSubject
                    });
                    this.showToast("Confirmation email sent successfully", "success");
                } catch (error) {
                    console.error("Failed to send confirmation email:", error);
                    this.showToast("Failed to send confirmation email", "error");
                }
            }

        } catch (error) {
            console.error('Error creating booking:', error);
            this.showToast("Failed to create booking", "error");
        }
    }

    openGoogleCalendar(contact) {
        
        const timezone = 'America/New_York';

        
        const startMoment = moment.tz(contact.startTime, "YYYY-MM-DD HH:mm", timezone);
        const endMoment = moment.tz(contact.endTime, "YYYY-MM-DD HH:mm", timezone);

        
        const startDateUTC = startMoment.clone().utc().format("YYYYMMDDTHHmmss") + "Z";
        const endDateUTC = endMoment.clone().utc().format("YYYYMMDDTHHmmss") + "Z";

        
        const title = `${contact.name} (${contact.room.join(", ")})`;
        const details = `${contact.notes} - Email: ${contact.email}`;

        
        const googleCalendarUrl = `https:

        
        window.open(googleCalendarUrl, '_blank');
    }

    createContract() {
        if (this.currentId === -1) {
            alert("Error: No contact selected.");
            return;
        }
        const contact = _.find(this.contacts, ["id", this.currentId]);
        if (!contact) {
            alert("Error: Contact not found.");
            return;
        }

        
        contact.room = Array.isArray(contact.room) ? contact.room : [contact.room];

        const date = moment(contact.startTime, "YYYY-MM-DD HH:mm").format("MM/DD/YYYY");
        const data = {
            issueDate: moment.tz().tz('America/New_York').format("MM/DD/YYYY"),
            contactName: contact.name,
            email: contact.email,
            phoneNumber: contact.phone,
            reservationDate: date,
            reservationTime: `${moment.tz(contact.startTime, 'America/New_York').format("HH:mm")}-${moment.tz(contact.endTime, 'America/New_York').format("HH:mm")}`,
            room: contact.room.join(", "),
            expectedAttenance: contact.attendance,
            typeOfParty: contact.partyType,
            totalFees: contact.rentalRate,
            minSpend: contact.minSpend,
            otherNotes: contact.notes,
            dj: contact.services.includes("dj"),
            band: contact.services.includes("band"),
            bar: contact.services.includes("bar"),
            lights: contact.services.includes("lights"),
            audio: contact.services.includes("audio"),
            music: contact.services.includes("music"),
            kareoke: contact.services.includes("kareoke"),
            catering: contact.services.includes("catering"),
            drink: contact.services.includes("drink"),
            clientSign: "",
            clientDate: "",
            tacoDate: moment.tz().tz('America/New_York').format("MM/DD/YYYY")
        };

        $.post("/api/createEventContract", data, (res) => {
            if (res === true) {
                const sanitizedDate = data.reservationDate.replace(/[\/-]/g, "_");
                const sanitizedName = data.contactName.replace(/ /g, "");
                window.open(`/files/EventContract_${sanitizedDate}_${sanitizedName}.pdf`);
            }
        });
    }
    generateDeposit() {
        const rentalFee = parseFloat($("#infoRentalRate").val()) || 0;
        const minSpend = parseFloat($("#infoMinSpend").val()) || 0;

        if (!rentalFee && !minSpend) {
            this.showToast("Please set either a rental fee or minimum spend first", "warning");
            return;
        }

        let depositText;
        if (rentalFee > 0) {
            depositText = `$${(rentalFee / 2).toFixed(2)} deposit to book.`;
        } else {
            const deposit = Math.min(minSpend / 2, 1200);
            depositText = `To host an event, a deposit of $${deposit.toFixed(2)} is required along with a minimum spend of $${minSpend.toFixed(2)} for the night. If the minimum spend requirement is met, the full deposit amount will be refunded. However, if the spend falls below the minimum requirement, the deposit will be forfeited in proportion to the amount by which the spend falls short.`;
        }

        const currentNotes = $("#infoNotes").val();
        const updatedNotes = currentNotes ? `${currentNotes}\n\n${depositText}` : depositText;
        $("#infoNotes").val(updatedNotes);
        this.showToast("Deposit information added to notes", "success");
    }


}


//--- File: /home/luan_ngo/web/events/public/index.html ---
<!DOCTYPE html>
<html lang="en">

<head>
    <title>EventSync</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    
    <script>
        
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
    </script>
    
    <link href="https:
    <link href="https:
    <link href="/styles.css" rel="stylesheet">
</head>

<body class="min-h-screen bg-base-100">
    
    <header class="sticky top-0 z-50 bg-base-100 border-b border-base-200">
        <div class="mx-auto px-4 py-3">
            <h1 class="text-2xl font-bold text-base-content">Event Management</h1>
        </div>
        
        <div class="hidden lg:flex fixed top-4 right-4 gap-2 z-50">
            <button class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Contacts">
                <i class="bi bi-address-book text-xl"></i>
            </button>
            <button class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Event Details">
                <i class="bi bi-info-circle text-xl"></i>
            </button>
            <button class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Messages">
                <i class="bi bi-envelope text-xl"></i>
            </button>
            <button class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Actions">
                <i class="bi bi-list text-xl"></i>
            </button>
            <button class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Calendar">
                <i class="bi bi-calendar text-xl"></i>
            </button>
            <button onclick="window.user_settings_modal.showModal()"
                class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Settings">
                <i class="bi bi-gear text-xl"></i>
            </button>
        </div>
    </header>

    
    <div class="mx-auto px-4 py-6">
        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            <aside class="lg:col-span-1">
                <div class="sticky top-20">
                    <div class="card bg-base-100 shadow-lg">
                        <div class="card-body p-4">
                            <div class="flex justify-between items-center">
                                <h2 class="card-title text-lg">Contacts</h2>
                                <div class="dropdown dropdown-end">
                                    <button tabindex="0" class="btn btn-ghost btn-sm btn-square tooltip"
                                        data-tip="Filter">
                                        <i class="bi bi-filter"></i>
                                    </button>
                                    <ul tabindex="0"
                                        class="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52">
                                        <li><a href="#" id="sortByName">Sort By Name</a></li>
                                        <li><a href="#" id="sortByDateBooked">Sort By Date Booked</a></li>
                                        <li><a href="#" id="sortByEventDate">Sort By Event Date</a></li>
                                        <li class="mt-2">
                                            <input type="text" class="input input-bordered w-full" id="searchInput"
                                                placeholder="Search">
                                        </li>
                                    </ul>
                                </div>
                            </div>
                            <div class="divider my-2"></div>
                            <div class="overflow-y-auto max-h-[calc(100vh-200px)]" id="contacts">
                                
                            </div>
                        </div>
                    </div>
                </div>
            </aside>

            
            <main class="lg:col-span-3 space-y-6">
                
                <section id="info" class="card bg-base-100 shadow-lg">
                    <div class="card-body">
                        <h2 class="card-title text-lg mb-4">Event Details</h2>

                        
                        <div class="grid lg:grid-cols-4 gap-6">

                            
                            <div class="lg:col-span-3 space-y-8">

                                
                                <div class="space-y-4">
                                    <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                        <i class="bi bi-person"></i>
                                        Contact Information
                                    </h3>
                                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Name</span>
                                            </label>
                                            <input type="text" id="infoName"
                                                class="input input-bordered w-full focus:border-primary" />
                                        </div>
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Phone</span>
                                            </label>
                                            <input type="tel" id="actionsPhone" class="input input-bordered w-full"
                                                pattern="[0-9]{3}-[0-9]{3}-[0-9]{4}" />
                                        </div>
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Email</span>
                                            </label>
                                            <input type="email" id="infoEmail" class="input input-bordered w-full" />
                                        </div>
                                    </div>
                                </div>

                                
                                <div class="space-y-4">
                                    <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                        <i class="bi bi-clock"></i>
                                        Event Timing
                                    </h3>
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Start Time</span>
                                            </label>
                                            <input type="datetime-local" id="infoStartTime"
                                                class="input input-bordered w-full" />
                                        </div>
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">End Time</span>
                                            </label>
                                            <input type="datetime-local" id="infoEndTime"
                                                class="input input-bordered w-full" />
                                        </div>
                                    </div>
                                </div>

                                
                                <div class="space-y-4">
                                    <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                        <i class="bi bi-info-circle"></i>
                                        Event Information
                                    </h3>
                                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Party Type</span>
                                            </label>
                                            <input type="text" id="infoPartyType" class="input input-bordered w-full" />
                                        </div>
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Expected Attendance</span>
                                            </label>
                                            <input type="number" id="infoAttendance"
                                                class="input input-bordered w-full" />
                                        </div>
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Status</span>
                                            </label>
                                            <select id="infoStatus" class="select select-bordered w-full" multiple>
                                                <option value="contractSent">Contract Sent</option>
                                                <option value="depositPaid">Deposit Paid</option>
                                                <option value="reserved">Reserved</option>
                                                <option value="completed">Event Completed</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                
                                <div class="space-y-4">
                                    <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                        <i class="bi bi-building"></i>
                                        Venue Details
                                    </h3>
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Room Selection</span>
                                            </label>
                                            <select id="infoRoom" class="select select-bordered w-full">
                                                <option value="Lounge">Lounge</option>
                                                <option value="DiningRoom">Dining Room</option>
                                                <option value="Patio">Patio</option>
                                            </select>
                                        </div>
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Services</span>
                                            </label>
                                            <select id="infoServices" class="select select-bordered w-full" multiple>
                                                <option value="dj">DJ</option>
                                                <option value="live">Live Band</option>
                                                <option value="bar">Private Bar</option>
                                                <option value="lights">Party Lights</option>
                                                <option value="audio">Audio Equipment</option>
                                                <option value="music">Music</option>
                                                <option value="kareoke">Karaoke</option>
                                                <option value="catering">Catering</option>
                                                <option value="drink">Drink Package</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                
                                <div class="space-y-4">
                                    <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                        <i class="bi bi-currency-dollar"></i>
                                        Financial Details
                                    </h3>
                                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Rental Rate</span>
                                            </label>
                                            <div class="relative">
                                                <span
                                                    class="absolute left-3 top-1/2 transform -translate-y-1/2">$</span>
                                                <input type="number" id="infoRentalRate"
                                                    class="input input-bordered w-full pl-7" />
                                            </div>
                                        </div>
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Minimum Spend</span>
                                            </label>
                                            <div class="relative">
                                                <span
                                                    class="absolute left-3 top-1/2 transform -translate-y-1/2">$</span>
                                                <input type="number" id="infoMinSpend"
                                                    class="input input-bordered w-full pl-7" />
                                            </div>
                                        </div>
                                        
                                        <div class="form-control">
                                            <label class="label">
                                                <span class="label-text font-medium">Hourly Rate</span>
                                            </label>
                                            <div class="flex items-center gap-2">
                                                <div class="relative flex-1">
                                                    <span
                                                        class="absolute left-3 top-1/2 transform -translate-y-1/2">$</span>
                                                    <input type="number" id="hourlyRate"
                                                        class="input input-bordered w-full pl-7" value="125" />
                                                </div>
                                                <button id="calcRate" class="btn btn-primary tooltip"
                                                    data-tip="Calculate">
                                                    <i class="bi bi-calculator"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                
                                <div class="border-t border-base-300 pt-6">
                                    <div class="flex flex-wrap gap-2">
                                        <button
                                            class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                            id="infoSave">
                                            <i class="bi bi-save text-xl text-primary"></i>
                                            <span class="text-xs font-medium">Save</span>
                                        </button>
                                        <button
                                            class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                            id="infoAddContact">
                                            <i class="bi bi-person-plus text-xl text-primary"></i>
                                            <span class="text-xs font-medium">Add Contact</span>
                                        </button>
                                        <button
                                            class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                            id="receipt">
                                            <i class="bi bi-receipt text-xl text-primary"></i>
                                            <span class="text-xs font-medium">Receipt</span>
                                        </button>
                                        <button
                                            class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                            id="summarizeEvent">
                                            <i class="bi bi-file-earmark-text text-xl text-primary"></i>
                                            <span class="text-xs font-medium">Summarize</span>
                                        </button>
                                        <button
                                            class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                            id="generateDeposit">
                                            <i class="bi bi-cash text-xl text-primary"></i>
                                            <span class="text-xs font-medium">Add Deposit</span>
                                        </button>
                                        <button
                                            class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                            id="actionsCreateContract">
                                            <i class="bi bi-file-text text-xl text-primary"></i>
                                            <span class="text-xs font-medium">Make Contract</span>
                                        </button>
                                        <button
                                            class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                            id="actionsEmailContract">
                                            <i class="bi bi-envelope text-xl text-primary"></i>
                                            <span class="text-xs font-medium">Email Contract</span>
                                        </button>
                                        <button
                                            class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                            id="actionsBookCalendar">
                                            <i class="bi bi-calendar-check text-xl text-primary"></i>
                                            <span class="text-xs font-medium">Add Calendar</span>
                                        </button>
                                    </div>
                                </div>

                                
                                <div id="depositPw" class="text-sm text-base-content/70"></div>
                            </div>

                            
                            <div class="lg:col-span-1 flex flex-col h-full space-y-4">
                                <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                    <i class="bi bi-journal-text"></i>
                                    Additional Notes
                                </h3>
                                <div class="form-control flex-1">
                                    <textarea id="infoNotes" class="textarea textarea-bordered w-full flex-1"
                                        placeholder="Enter any additional notes or special requirements..."></textarea>
                                </div>
                            </div>

                        </div>
                    </div>
                </section>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-12rem)]">
                    
                    <section id="messages" class="card bg-base-100 shadow-lg h-full">
                        <div class="card-body flex flex-col h-full p-6">
                            <div class="flex justify-between items-center mb-4">
                                <h2 class="card-title text-lg">Messages</h2>
                                <div class="flex gap-2">
                                    <div id="toggleRepliedEmails"></div> 

                                    <button class="btn btn-ghost btn-sm btn-square tooltip tooltip-left"
                                        data-tip="Read Email" id="readAllEmails">
                                        <i class="bi bi-envelope"></i>
                                    </button>
                                    <button class="btn btn-ghost btn-sm btn-square tooltip tooltip-left"
                                        data-tip="Get Interac" id="getInterac">
                                        <i class="bi bi-cash-coin"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="messages-container flex-1 overflow-y-auto">
                                
                            </div>
                        </div>
                    </section>

                    
                    <section id="actions" class="card bg-base-100 shadow-lg h-full">
                        <div class="card-body flex flex-col h-full p-6">
                            <h2 class="card-title text-lg mb-4">Actions & AI Assistant</h2>
                            <div class="flex flex-wrap gap-2 mb-4">
                            </div>

                            
                            <div class="flex-1 flex flex-col bg-base-200 rounded-lg p-4">
                                
                                <div class="flex justify-between items-center mb-2">
                                    <h3 class="font-bold">AI Conversation</h3>
                                    <button id="maximizeAiResult" class="btn btn-ghost btn-xs btn-square tooltip"
                                        data-tip="Maximize">
                                        <i class="bi bi-arrows-fullscreen"></i>
                                    </button>
                                </div>

                                
                                <div class="flex-1 overflow-y-auto bg-base-100 rounded-lg p-2 mb-4" id="aiResult">
                                </div>

                                
                                <div class="mt-auto">
                                    <div class="flex items-center gap-2 mb-2">
                                        <h3 class="font-bold">Message</h3>
                                        <button id="toggleButton" class="btn btn-ghost btn-xs btn-square tooltip"
                                            data-tip="Expand">
                                            <i class="bi bi-arrows-fullscreen"></i>
                                        </button>
                                    </div>
                                    <div contenteditable="true"
                                        class="bg-base-100 rounded-lg p-2 h-32 overflow-y-auto focus:outline-none border border-base-300 mb-4"
                                        id="aiText">
                                    </div>
                                    <div class="space-y-4">
                                        <div class="flex flex-wrap gap-4">
                                            <button
                                                class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                                id="actionSendAI">
                                                <i class="bi bi-chat-dots text-xl text-primary"></i>
                                                <span class="text-xs font-medium">Chat</span>
                                            </button>
                                            <button
                                                class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                                id="confirmAI">
                                                <i class="bi bi-check-circle text-xl text-primary"></i>
                                                <span class="text-xs font-medium">Confirm</span>
                                            </button>
                                            <button
                                                class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                                id="clearAiText">
                                                <i class="bi bi-trash text-xl text-primary"></i>
                                                <span class="text-xs font-medium">Clear</span>
                                            </button>
                                            <button
                                                class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                                id="eventAI">
                                                <i class="bi bi-calendar-plus text-xl text-primary"></i>
                                                <span class="text-xs font-medium">Event</span>
                                            </button>
                                            <button
                                                class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                                id="emailAI">
                                                <i class="bi bi-envelope text-xl text-primary"></i>
                                                <span class="text-xs font-medium">Email</span>
                                            </button>
                                        </div>

                                        <div class="flex items-center gap-2">
                                            <input type="text" id="sendMailEmail" class="input input-bordered flex-1"
                                                placeholder="Email">
                                            <input type="text" id="sendMailSubject" class="input input-bordered flex-1"
                                                placeholder="Subject">
                                            <button
                                                class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                                id="sendEmail">
                                                <i class="bi bi-send text-xl text-primary"></i>
                                                <span class="text-xs font-medium">Send</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </div>
        <div class="py-6">
            <section id="calendar" class="card bg-base-100 shadow-lg">
                <div class="card-body">
                    <h2 class="card-title text-lg mb-4">Calendar</h2>
                    <div id="calendarContainer" class="w-full">
                        
                    </div>
                </div>
            </section>
        </div>
    </div>


    <div class="md:hidden btm-nav"> 
        <button onclick="scrollToSection('contacts')" class="tooltip tooltip-top" data-tip="Contacts">
            <i class="bi bi-people text-xl"></i> 
        </button>
        <button onclick="scrollToSection('info')" class="tooltip tooltip-top" data-tip="Event Details">
            <i class="bi bi-info-circle text-xl"></i>
        </button>
        <button onclick="scrollToSection('messages')" class="tooltip tooltip-top" data-tip="Messages">
            <i class="bi bi-envelope text-xl"></i>
        </button>
        <button onclick="scrollToSection('actions')" class="tooltip tooltip-top" data-tip="Actions">
            <i class="bi bi-list text-xl"></i>
        </button>
        <button onclick="scrollToSection('calendar')" class="tooltip tooltip-top" data-tip="Calendar">
            <i class="bi bi-calendar text-xl"></i>
        </button>
        <button onclick="window.user_settings_modal.showModal()" class="tooltip tooltip-top" data-tip="Settings">
            <i class="bi bi-gear text-xl"></i>
        </button>
    </div>
    <dialog id="maximize_content_modal" class="modal">
        <div class="modal-box w-11/12 max-w-7xl h-[90vh]"> 
            <h3 class="font-bold text-lg mb-4" id="maximizeModalTitle">Content View</h3>
            <div id="maximizedContent" class="overflow-y-auto max-h-[calc(100%-8rem)] bg-base-100 rounded-lg p-4"
                contenteditable="false">
                
            </div>
            <div class="modal-action">
                <form method="dialog">
                    <button class="btn">Close</button>
                </form>
            </div>
        </div>
    </dialog>
    
    <dialog id="user_settings_modal" class="modal">
        <div class="modal-box">
            <h2 class="text-xl font-semibold mb-4">User Settings</h2>

            
            <div class="mb-6">
                <h3 class="font-bold mb-2">Google Account Access</h3>
                <p class="text-sm text-base-content/70 mb-2">
                    Connect your Google account to access emails and calendar events.
                </p>
                <button id="googleOAuthButton" class="btn btn-primary btn-block gap-2 mb-2">
                    <i class="bi bi-google"></i>
                    Sign in with Google
                </button>
                <div id="connectedEmail" class="text-sm text-success"></div>
            </div>

            <div class="mb-6">
                <h3 class="font-bold mb-2">Email Categories</h3>
                <p class="text-sm text-base-content/70 mb-2">
                    Customize the email categories used for categorization.
                </p>
                <div class="form-control">
                    <table class="table w-full">
                        <thead>
                            <tr>
                                <th>Category</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    <input type="text" id="emailCategoryName-0" class="input input-bordered w-full"
                                        placeholder="Category Name" />
                                </td>
                                <td>
                                    <input type="text" id="emailCategoryDescription-0"
                                        class="input input-bordered w-full" placeholder="Category Description" />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <button class="btn btn-primary mt-2" id="addEmailCategory">Add Category</button>
                </div>
            </div>

            
            
            <div class="mb-6">
                <h3 class="font-bold mb-2">AI Background Information</h3>
                <p class="text-sm text-base-content/70 mb-2">
                    This information will be used to provide context to the AI about your venue, services, and policies.
                </p>
                <div class="form-control">
                    <textarea id="backgroundInfo" class="textarea textarea-bordered min-h-[200px]"
                        placeholder="Enter venue details, services, policies, and any other relevant information the AI should know about..."></textarea>
                </div>
                <div id="saveStatus" class="alert mt-2 hidden">
                    <i class="bi bi-info-circle"></i>
                    <span id="saveStatusText"></span>
                </div>
                <button id="saveBackgroundInfo" class="btn btn-primary gap-2 mt-4">
                    <i class="bi bi-save"></i>
                    Save Background Info
                </button>
            </div>
            
            <div class="mb-6">
                <h3 class="font-bold mb-2">Account</h3>
                <button id="logoutButton" class="btn btn-outline btn-error btn-block gap-2">
                    <i class="bi bi-box-arrow-right"></i>
                    Logout
                </button>
            </div>

            <div class="modal-action">
                <form method="dialog">
                    <button class="btn">Close</button>
                </form>
            </div>
        </div>
    </dialog>

    
    <script src="https:
    <script src="https:
        integrity="sha512-WFN04846sdKMIP5LKNphMaWzU7YpMyCU245etK3g/2ARYbPK9Ub18eG+ljU96qKRCWh+quCY7yefSmlkQw1ANQ=="
        crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script src="https:
    <script
        src="https:
        integrity="sha512-s932Fui209TZcBY5LqdHKbANLKNneRzBib2GE3HkZUQtoWY3LBUN2kaaZDK7+8z8WnFY23TPUNsDmIAY1AplPg=="
        crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script src="https:
    <script src="https:
    <script src="https:

    <script src="/EmailEventUpdater.js"></script>
    <script src="/EmailProcessor.js"></script>
    <script src="/ReceiptManager.js"></script>
    <script src="/calendar.js"></script>
    <script type="module">
        import { EventManageApp } from '/scripts.js';
        window.app = new EventManageApp();

        document.addEventListener('DOMContentLoaded', function () {
            window.app.init();
        });
    </script>
</body>

</html>

//--- File: /home/luan_ngo/web/events/public/EmailProcessor.js ---
class EmailProcessor {
    constructor(parent) {
        this.currentConversationId = null;
        this.registerEvents();
        this.parent = parent;
        this.userSettings = {
            userSettings: {
                async loadSettings() {
                    try {
                        const response = await fetch('/api/settings/email-categories');
                        return await response.json();
                    } catch (error) {
                        console.error('Error loading user settings:', error);
                        return {
                            emailCategories: [
                                {
                                    "name": "event_platform",
                                    "description": "Emails mentioning Tagvenue or Peerspace"
                                },
                                {
                                    "name": "event",
                                    "description": "Emails related to event bookings, catering, drinks. do not include opentable emails."
                                },
                                {
                                    "name": "other",
                                    "description": "Any other type of email, including receipts"
                                }
                            ]
                        };
                    }
                },
                async saveSettings(settings) {
                    try {
                        const response = await fetch('/api/settings/email-categories', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(settings)
                        });
                        return await response.json();
                    } catch (error) {
                        console.error('Error saving user settings:', error);
                        throw error;
                    }
                }
            }
        }
        this.initializeEmailFilters(); 
    }
    async initializeEmailFilters() {
        try {
            
            const categories = await this.userSettings.userSettings.loadSettings();

            
            const $filterButton = $('#toggleRepliedEmails');
            const $dropdown = $(`
                <div class="dropdown dropdown-end">
                    <button class="btn btn-sm" tabindex="0">
                        <i class="bi bi-filter"></i>
                        <span class="ml-2">Filter</span>
                    </button>
                    <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                        <li class="menu-title pt-0">
                            <span>Show Emails</span>
                        </li>
                        <li>
                            <label class="flex items-center gap-2">
                                <input type="checkbox" class="checkbox checkbox-sm" data-filter="replied">
                                <span>Replied</span>
                            </label>
                        </li>
                        <li>
                            <label class="flex items-center gap-2">
                                <input type="checkbox" class="checkbox checkbox-sm" data-filter="archived">
                                <span>Archived</span>
                            </label>
                        </li>
                        <li class="menu-title">
                            <span>Categories</span>
                        </li>
                        ${categories.emailCategories.map(category => `
                            <li>
                                <label class="flex items-center gap-2">
                                    <input type="checkbox" class="checkbox checkbox-sm" data-filter="category" data-category="${category.name}">
                                    <span>${category.name}</span>
                                </label>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `);

            $filterButton.replaceWith($dropdown);

            
            this.filters = {
                replied: false,
                archived: false,
                categories: new Set()
            };

            
            this.originalEmails = [];

            
            $dropdown.find('input[type="checkbox"]').on('change', (e) => {
                const $checkbox = $(e.target);
                const filterType = $checkbox.data('filter');
                const isChecked = $checkbox.prop('checked');

                if (filterType === 'category') {
                    const category = $checkbox.data('category');
                    if (isChecked) {
                        this.filters.categories.add(category);
                    } else {
                        this.filters.categories.delete(category);
                    }
                } else {
                    this.filters[filterType] = isChecked;
                }

                
                this.applyFilters();
            });

            
            const originalReadGmail = this.parent.readGmail;
            this.parent.readGmail = async (...args) => {
                const response = await originalReadGmail.apply(this.parent, args);
                if (Array.isArray(response)) {
                    this.originalEmails = response;
                }
                return response;
            };
        } catch (error) {
            console.error('Error initializing email filters:', error);
        }
    }

    applyFilters() {
        if (!Array.isArray(this.originalEmails)) return;

        let filteredEmails = this.originalEmails.filter(email => {
            
            if (!this.filters.replied &&
                !this.filters.archived &&
                this.filters.categories.size === 0) {
                return true;
            }

            
            let showEmail = false;

            
            if (this.filters.replied && email.replied) {
                showEmail = true;
            }

            
            if (this.filters.archived && email.labels?.includes('Label_6')) {
                showEmail = true;
            }

            
            if (this.filters.categories.size > 0 && email.category) {
                if (this.filters.categories.has(email.category)) {
                    showEmail = true;
                }
            }

            return showEmail;
        });

        
        this.parent.processEmails(filteredEmails, { ignoreFilters: true });

        
        const $filterButton = $('.dropdown > button');
        const activeFilters = [
            this.filters.replied && 'Replied',
            this.filters.archived && 'Archived',
            ...Array.from(this.filters.categories)
        ].filter(Boolean);

        if (activeFilters.length > 0) {
            $filterButton.addClass('btn-primary');
            $filterButton.html(`
                <i class="bi bi-filter"></i>
                <span class="ml-2">${activeFilters.length} active</span>
            `);
        } else {
            $filterButton.removeClass('btn-primary');
            $filterButton.html(`
                <i class="bi bi-filter"></i>
                <span class="ml-2">Filter</span>
            `);
        }
    }

    registerEvents() {
        $(document).on('click', '.draftEventSpecificEmail', async (e) => {
            e.preventDefault();
            const $target = $(e.target);
            const $button = $target.hasClass('draftEventSpecificEmail') ?
                $target : $target.closest('.draftEventSpecificEmail');
            const $emailContainer = $button.closest('.sms');

            const messageId = $emailContainer.data('id');
            const emailAddress = $emailContainer.attr('to');
            const subject = $emailContainer.attr('subject');
            const emailContent = $emailContainer.find('.email').text();

            
            $('#aiText').data('replyToMessageId', messageId);
            $('#aiText').data('source', 'draftEventSpecificEmail');

            
            const originalHtml = $button.html();
            $button.html('<i class="bi bi-hourglass-split animate-spin"></i>');

            try {
                await this.handleDraftEventEmail(emailContent, subject, emailAddress, messageId);
            } finally {
                
                $button.html(originalHtml);
            }
        });

        $(document).on('click', '.sendToAiTextArea', async (e) => {
            e.preventDefault();
            const $target = $(e.target);
            const $button = $target.hasClass('sendToAiTextArea') ?
                $target : $target.closest('.sendToAiTextArea');
            const $emailContainer = $button.closest('.sms');

            const messageId = $emailContainer.data('id');
            const emailAddress = $emailContainer.attr('to');
            const subject = $emailContainer.attr('subject');
            const emailContent = $emailContainer.find('.email').text();

            
            $('#aiText').data('replyToMessageId', messageId);
            $('#aiText').data('source', 'sendToAiTextArea');

            await this.sendToAiTextArea(emailContent, subject, emailAddress, messageId);
        });
        
        $(document).on('click', '.summarizeEmailAI', async (e) => {
            e.preventDefault();
            const emailContent = $(e.target).closest('.sms').find('.email').text();
            await this.handleSummarizeEmail(emailContent);
        });

        

        $(document).on('click', '.archiveEmail', async (e) => {
            e.preventDefault();
            const $emailContainer = $(e.target).closest('.sms');
            const messageId = $emailContainer.data('id');

            const success = await this.archiveEmail(messageId);
            if (success) {
                window.app.showToast('Email archived successfully', 'success');
            } else {
                window.app.showToast('Failed to archive email', 'error');
            }
        });

        
        $(document).on('click', '#newConversation', () => {
            this.startNewConversation();
        });
    }

    startNewConversation() {
        this.currentConversationId = null;
        $('#aiText').html('');
        $('#aiResult').html('');
        $('#sendMailSubject').val(''); 

    }

    async handleSummarizeEmail(emailContent) {
        try {
            
            const cleanedText = emailContent
                .replace(/[-<>]/g, '')
                .replace(/^Sent:.*$/gm, '')
                .substring(0, 11000);

            const response = await $.post('/api/summarizeAI', {
                text: cleanedText,
                conversationId: this.currentConversationId
            });

            
            this.currentConversationId = response.conversationId;

            
            this.parent.writeToAIResult(response.summary);

        } catch (error) {
            console.error('Error summarizing email:', error);
            alert('Failed to summarize email');
        }
    }



    async archiveEmail(messageId) {
        try {
            const response = await $.post(`/gmail/archiveEmail/${messageId}`);
            if (response.success) {
                
                $(`.sms[data-id="${messageId}"]`).fadeOut(300, function () {
                    $(this).remove();
                });
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error archiving email:', error);
            return false;
        }
    }
    async handleDraftEventEmail(emailContent, subject, emailAddress, messageId) {
        try {
            const response = await $.post('/api/getAIEmail', {
                emailText: emailContent,
                conversationId: this.currentConversationId,
                includeBackground: true
            });

            
            this.setupEmailForm({
                emailAddress,
                subject,
                messageId,
                response,
                source: 'draftEventSpecificEmail'
            });

            
            this.parent.writeToAIResult(response.response.toString().replace(/\n/g, '<br>'));

            
            if (this.parent.sounds?.orderUp) {
                this.parent.sounds.orderUp.play();
            }

        } catch (error) {
            console.error('Error drafting event email:', error);
            this.parent.showToast('Failed to draft event email', 'error');
        }
    }
    async sendToAiTextArea(emailContent, subject, emailAddress, messageId) {
        
        const formattedContent = this.formatEmailContent(emailContent);

        
        this.setupEmailForm({
            emailAddress,
            subject,
            messageId,
            source: 'sendToAiTextArea'
        });

        
        $('#aiText').html(this.currentConversationId ?
            $('#aiText').html() + '<br><br>--------------------<br><br>' + formattedContent :
            formattedContent
        );

        
        $('html, body').animate({
            scrollTop: $('#aiText').offset().top
        }, 500);

        $('#aiText').focus();
    }
    setupEmailForm({ emailAddress, subject, messageId, response = {}, source }) {
        
        if (emailAddress) {
            $('#sendMailEmail').val(emailAddress);
        }

        
        if (subject) {
            const subjectText = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
            $('#sendMailSubject').val(subjectText);
        }

        
        $('#aiText').data('replyToMessageId', messageId);
        $('#aiText').data('source', source);

        
        if (response.conversationId) {
            this.currentConversationId = response.conversationId;
        }

        
        if (response.messageCount) {
            this.updateConversationStatus(response.messageCount);
        }
    }

    formatEmailContent(content) {
        return content
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\n/g, '<br>');
    }
    updateConversationStatus(messageCount) {
        if (messageCount) {
            const statusHtml = `<div class="text-muted small mt-2">Conversation messages: ${messageCount}</div>`;
            $('.aiChatReponse').first().find('.aiChatReponseContent').after(statusHtml);
        }
    }
}
