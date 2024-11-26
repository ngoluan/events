const express = require('express');
const moment = require('moment-timezone');
const { z } = require('zod');
const aiService = require('./aiService');
const GoogleCalendarService = require('./googleCalendarService');
var plivo = require('plivo');
const historyManager = require('./HistoryManager');
const Utils = require('./Utils');

class EmailProcessorServer {
    constructor(googleAuth, gmailService, eventService) {  // Add gmailService parameter
        this.router = express.Router();
        this.router.use(express.json());
        this.router.use(express.urlencoded({ extended: true }));
        this.googleCalendarService = new GoogleCalendarService(googleAuth);
        this.gmailService = gmailService;  // Store the gmailService instance
        this.eventService = eventService;

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
                    // Send confirmation SMS
                    await this.sendSMS({
                        to: From,
                        message: result.message
                    });
                    res.json(result);
                } else {
                    // Send error message
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


                // Include event details in the prompt if available
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

                // Process each inquiry type in the array
                // Initialize background tracking
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
                    // Combine multiple responses into one coherent email
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
                    // Single response case
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
                      
                              You are a booking assistant for TacoTaco restaurant. Extract event details from this email and provide them in JSON format. 

                                Follow these guidelines carefully:
                                1. EXCLUDE these as customer details (they are staff):
                                - Names: "Liem Ngo" or "Luan Ngo"
                                - Email: "info@eattaco.ca"
                                - Phone: "(647) 692-4768"

                                2. Room options MUST be one of:
                                - "Lounge" (also known as Moonlight Lounge)
                                - "DiningRoom" (also known as Dining Room)
                                - "Patio" (for outdoor space)

                                3. Services should be an array containing any of these exact values:
                                - "dj" - for DJ services
                                - "live" - for Live Band
                                - "bar" - for Private Bar service
                                - "lights" - for Party Lights
                                - "audio" - for Audio Equipment
                                - "music" - for Background Music
                                - "kareoke" - for Karaoke
                                - "catering" - for Food Service
                                - "drink" - for Drink Packages

                                5. Party Types should be specific (e.g., "Birthday Party", "Corporate Event", "Wedding Reception", etc.)

                                6. Notes field should include:
                                - Special requests
                                - Dietary restrictions
                                - Setup requirements
                                - Payment discussions
                                - But EXCLUDE basic venue information

                                Provide the JSON in this exact format:
                                {
                                    "name": "contact name",
                                    "email": "contact email",
                                    "phone": "contact phone (optional, include only if specifically mentioned)",
                                    "partyType": "type of event",
                                    "startTime": "YYYY-MM-DD HH:mm",
                                    "endTime": "YYYY-MM-DD HH:mm",
                                    "room": "Lounge | DiningRoom | Patio",
                                    "attendance": "number of expected guests",
                                    "services": ["array of applicable services from the list above"],
                                    "notes": "important details excluding venue information (optional)"
                                }

                                Email content:
                                ${cleanedText}
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

            // Get only the first unnotified event email
            const eventEmail = newEmails
                .filter(email =>
                    email.category === 'event' &&
                    !email.hasNotified &&
                    !email.labels.includes('SENT') && // Filter out sent emails
                    email.labels.includes('INBOX')  // Ensure it's in inbox
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

                // Get the email thread to find previous messages
                const threadMessages = await this.gmailService.getThreadMessages(eventEmail.threadId);
                const previousMessage = threadMessages
                    .filter(msg => msg.id !== eventEmail.id)
                    .sort((a, b) => Number(b.internalDate) - Number(a.internalDate))[0];

                const cleanedEmailContent = Utils.cleanEmailContent(eventEmail.text || eventEmail.snippet || '');

                // Generate context-aware summary
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

                // Generate AI response for the email
                const aiEmailResponse = await this.getAIEmail({
                    emailText: cleanedEmailContent,
                    eventDetails: eventDetails || {}
                });
                // Send initial email details with enhanced summary
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

                // Send proposed response in second message
                const responseContent = `
                Proposed Response (Part 2/2):
                
                ${this.truncateText(aiEmailResponse.response, 1400)}
                `.trim();

                await this.sendSMS({
                    to: process.env.NOTIFICATION_PHONE_NUMBER,
                    message: responseContent
                });

                // Store the proposed email data in history
                historyManager.addEntry({
                    type: 'pendingEmailResponse',
                    shortId: shortId,
                    emailId: eventEmail.id,
                    proposedEmail: aiEmailResponse.response,
                    emailSubject: `Re: ${eventEmail.subject}`,
                    emailRecipient: eventEmail.from.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0],
                    timestamp: new Date().toISOString()
                });

                // Mark email as notified
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

    // Helper method to truncate text while keeping whole words
    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;

        const truncated = text.slice(0, maxLength - 3);
        const lastSpace = truncated.lastIndexOf(' ');

        if (lastSpace === -1) return truncated + '...';
        return truncated.slice(0, lastSpace) + '...';
    }


    // Helper method to handle the AI email generation
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
                summary: aiResponse.response.split('\n')[0] // Use first line as summary
            };

        } catch (error) {
            console.error('Error generating AI response:', error);
            throw error;
        }
    }
    // Add this method to handle SMS replies
    async handleSMSReply(messageText, fromNumber) {
        try {
            // Extract the command and shortId
            const match = messageText.trim().match(/^(YES|EDIT)([0-9a-zA-Z]+)(?:\s+(.*))?$/i);

            if (!match) {
                return {
                    success: false,
                    message: 'Invalid format. Please reply with YES{id} or EDIT{id} {new_message}'
                };
            }

            const [, command, shortId, additionalText] = match;
            const upperCommand = command.toUpperCase();

            // Get the pending email data from history
            const pendingEmail = historyManager.getRecentEntriesByType('pendingEmailResponse')
                .find(entry => entry.shortId === shortId);

            if (!pendingEmail) {
                return {
                    success: false,
                    message: `No pending email found for ID ${shortId}`
                };
            }

            if (upperCommand === 'YES') {
                // Send the original proposed email
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
                // Send the modified email
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

            // Log the SMS sending in history with type 'sendSMS'
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

            // Log the failed SMS attempt
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
