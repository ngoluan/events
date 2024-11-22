
//--- File: /home/luan_ngo/web/events/services/gmailService.js ---
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const cheerio = require('cheerio');
class GmailService {
    constructor(auth, eventService = null) {
        this.auth = auth;
        this.cacheFilePath = path.join(__dirname, '..', 'data', 'emails.json');
        this.lastRetrievalPath = path.join(__dirname, '..', 'data', 'lastRetrieval.json');
        this.emailCache = new Map();
        this.lastRetrievalDate = this.loadLastRetrievalDate();

        
        this.aiService = require('./aiService');

        
        this.eventService = eventService;

        
        this.eventsCache = [];
        this.lastEventsCacheUpdate = 0;

        this.categorySchema = {
            type: 'object',
            properties: {
                category: {
                    enum: ['event', 'event_platform', 'other']
                }
            },
            required: ['category']
        };

        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    setEventService(eventService) {
        this.eventService = eventService;
        this.refreshEventsCache();
    }

    
    async refreshEventsCache() {
        this.eventsCache = this.eventsService.loadEvents();
        this.lastEventsCacheUpdate = Date.now();
    }

    
    shouldRefreshEventsCache() {
        const CACHE_LIFETIME = 5 * 60 * 1000; 
        return Date.now() - this.lastEventsCacheUpdate > CACHE_LIFETIME;
    }
    
    async sendEmail(to, subject, html) {
        try {
            const authClient = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth: authClient });

            
            const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
            const messageParts = [
                `To: ${to}`,
                `Subject: ${utf8Subject}`,
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=utf-8',
                '',
                html
            ];
            const message = messageParts.join('\n');

            
            const encodedMessage = Buffer.from(message)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\
                .replace(/=+$/, '');

            const res = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedMessage
                }
            });

            return res.data;
        } catch (error) {
            console.error('Error sending email:', error);
            throw error;
        }
    }

    loadLastRetrievalDate() {
        try {
            if (fs.existsSync(this.lastRetrievalPath)) {
                const data = JSON.parse(fs.readFileSync(this.lastRetrievalPath, 'utf8'));
                return data.lastRetrieval;
            }
        } catch (error) {
            console.error('Error loading last retrieval date:', error);
        }
        
        return moment().subtract(30, 'minutes').format('YYYY-MM-DD HH:mm:ss');
    }

    saveLastRetrievalDate() {
        try {
            const data = {
                lastRetrieval: moment().format('YYYY-MM-DD HH:mm:ss')
            };
            fs.writeFileSync(this.lastRetrievalPath, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving last retrieval date:', error);
        }
    }
    saveEmailsToCache(emails) {
        try {
            
            const sortedEmails = emails.sort((a, b) => {
                return new Date(b.internalDate) - new Date(a.internalDate);
            });
            fs.writeFileSync(this.cacheFilePath, JSON.stringify(sortedEmails, null, 2), 'utf8');

            
            sortedEmails.forEach(email => {
                this.emailCache.set(email.id, email);
            });
        } catch (error) {
            console.error('Error saving emails to cache:', error);
        }
    }

    loadEmailsFromCache() {
        try {
            if (fs.existsSync(this.cacheFilePath)) {
                const emails = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8'));
                
                emails.forEach(email => {
                    this.emailCache.set(email.id, email);
                });
                return emails;
            }
        } catch (error) {
            console.error('Error loading emails from cache:', error);
        }
        return [];
    }
    async listMessages(options = {}) {
        try {
            const authClient = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth: authClient });

            
            const sentResponse = await gmail.users.messages.list({
                userId: 'me',
                maxResults: options.maxResults || 100,
                q: options.email ? `from:me to:${options.email}` : 'in:sent',
                orderBy: 'internalDate desc'
            });

            const sentMessages = sentResponse.data.messages || [];

            
            const fullSentMessages = await Promise.all(
                sentMessages.map(async msg => {
                    try {
                        return await this.getMessage(msg.id);
                    } catch (err) {
                        console.error(`Error getting sent message ${msg.id}:`, err);
                        return null;
                    }
                })
            ).then(messages => messages.filter(msg => msg !== null));

            let query = options.email ? `{to:${options.email} from:${options.email}}` : 'in:inbox';
            if (options.query) {
                query = ` ${options.query}`;
            }
            
            const inboxResponse = await gmail.users.messages.list({
                userId: 'me',
                maxResults: options.maxResults || 100,
                q: query,
                orderBy: 'internalDate desc'
            });

            const inboxMessages = inboxResponse.data.messages || [];

            
            const processedMessages = await this.processMessageBatch(
                inboxMessages,
                fullSentMessages
            );

            if (!options.email) {
                this.saveLastRetrievalDate();
            }

            return processedMessages;

        } catch (error) {
            console.error('Error listing messages:', error);
            throw error;
        }
    }

    checkIfReplied(inboxMessage, sentMessages) {
        try {
            const threadId = inboxMessage.threadId;
            let messageId = '';

            
            if (inboxMessage?.payload?.headers) {
                messageId = inboxMessage.payload.headers.find(h => h.name === 'Message-ID')?.value || '';
            }

            const hasReply = sentMessages.some(sentMessage => {
                
                if (sentMessage.threadId !== threadId) {
                    return false;
                }

                let inReplyTo = '';
                let references = '';

                
                if (sentMessage?.payload?.headers) {
                    inReplyTo = sentMessage.payload.headers.find(h => h.name === 'In-Reply-To')?.value || '';
                    references = sentMessage.payload.headers.find(h => h.name === 'References')?.value || '';
                } else {
                    inReplyTo = sentMessage.inReplyTo || '';
                    references = sentMessage.references || '';
                }

                
                if (messageId && (inReplyTo.includes(messageId) || references.includes(messageId))) {
                    return true;
                }

                
                const sentDate = new Date(sentMessage.internalDate);
                const inboxDate = new Date(inboxMessage.internalDate);

                
                return sentDate > inboxDate;
            });

            return hasReply;

        } catch (error) {
            console.error('Error checking if replied:', error);
            return false;
        }
    }

    async getMessage(messageId) {
        try {
            
            if (this.emailCache.has(messageId)) {
                return this.emailCache.get(messageId);
            }

            const auth = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth });
            const emailData = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full'
            });

            let html = '';
            let text = '';
            if (emailData.data.payload.mimeType === 'text/plain' && emailData.data.payload.body.data) {
                text = Buffer.from(emailData.data.payload.body.data, 'base64').toString('utf8');
            } else if (emailData.data.payload.mimeType === 'text/html' && emailData.data.payload.body.data) {
                html = Buffer.from(emailData.data.payload.body.data, 'base64').toString('utf8');
            } else if (emailData.data.payload.parts) {
                const { html: htmlPart, text: textPart } = this.parseEmailParts(emailData.data.payload.parts);
                html = htmlPart;
                text = textPart;
            }

            
            if (!text && html) {
                text = this.extractPlainTextFromHtml(html);
            }

            
            const fullMessage = {
                id: messageId,
                threadId: emailData.data.threadId,
                labelIds: emailData.data.labelIds,
                snippet: emailData.data.snippet,
                internalDate: emailData.data.internalDate,
                payload: emailData.data.payload,
                parsedContent: {
                    text,
                    html
                }
            };

            return fullMessage;
        } catch (error) {
            console.error('Error getting message:', error);
            throw error;
        }
    }
    parseEmailParts(parts) {
        let htmlContent = '';
        let textContent = '';

        if (parts && parts.length > 0) {
            parts.forEach(part => {
                if (part.parts && part.parts.length > 0) {
                    const { html, text } = this.parseEmailParts(part.parts);
                    htmlContent += html;
                    textContent += text;
                } else {
                    if (part.mimeType === 'text/html') {
                        const data = part.body.data;
                        if (data) {
                            htmlContent += Buffer.from(data, 'base64').toString('utf8');
                        }
                    } else if (part.mimeType === 'text/plain') {
                        const data = part.body.data;
                        if (data) {
                            textContent += Buffer.from(data, 'base64').toString('utf8');
                        }
                    }
                }
            });
        }
        return { html: htmlContent, text: textContent };
    }
    async processMessageBatch(messages, sentMessages) {
        if (!messages || !messages.length) return [];

        const asyncLib = require('async');
        let processedEmails = [];

        await asyncLib.eachLimit(messages, 5, async (message) => {
            try {
                const fullMessage = await this.getMessage(message.id);
                let emailData;

                if (fullMessage?.payload?.headers) {
                    const headers = fullMessage.payload.headers;
                    const replied = this.checkIfReplied(fullMessage, sentMessages);

                    emailData = {
                        id: message.id,
                        threadId: fullMessage.threadId,
                        from: headers.find(h => h.name === 'From')?.value || '',
                        to: headers.find(h => h.name === 'To')?.value || '',
                        subject: headers.find(h => h.name === 'Subject')?.value || '',
                        timestamp: headers.find(h => h.name === 'Date')?.value || '',
                        internalDate: fullMessage.internalDate,
                        text: fullMessage?.parsedContent?.text || '',
                        html: fullMessage?.parsedContent?.html || '',
                        labels: fullMessage.labelIds || [],
                        snippet: fullMessage.snippet || '',
                        replied
                    };

                    
                    const [eventAssociation, category] = await Promise.all([
                        this.checkEventAssociation(emailData),
                        this.categorizeEmail(emailData)
                    ]);

                    
                    emailData.associatedEventId = eventAssociation.eventId;
                    emailData.associatedEventName = eventAssociation.eventName;
                    emailData.category = category;

                } else {
                    emailData = {
                        id: fullMessage.id || message.id,
                        threadId: fullMessage.threadId || '',
                        from: fullMessage.from || '',
                        to: fullMessage.to || '',
                        subject: fullMessage.subject || '',
                        timestamp: fullMessage.timestamp || '',
                        internalDate: fullMessage.internalDate || '',
                        text: fullMessage.text || fullMessage?.parsedContent?.text || '',
                        html: fullMessage.html || fullMessage?.parsedContent?.html || '',
                        labels: fullMessage.labels || fullMessage.labelIds || [],
                        snippet: fullMessage.snippet || '',
                        replied: fullMessage.replied || this.checkIfReplied(fullMessage, sentMessages) || false,
                        category: 'other',
                        associatedEventId: null,
                        associatedEventName: null
                    };
                }

                this.emailCache.set(message.id, emailData);
                processedEmails.push(emailData);

            } catch (err) {
                console.error(`Error processing message ID ${message.id}:`, err);
            }
        });

        return processedEmails.sort((a, b) => {
            const dateA = Number(a.internalDate);
            const dateB = Number(b.internalDate);
            return dateB - dateA;
        });
    }
    extractPlainTextFromHtml(html) {
        let plainText = "";

        try {
            let cleanedHtml = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
            cleanedHtml = cleanedHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
            const $ = cheerio.load(cleanedHtml);
            plainText = $.text().trim();
            plainText = plainText.replace(/ {2,}/g, ' ');
            plainText = plainText.replace(/\t+/g, ' ');
            plainText = plainText.replace(/\n{3,}/g, '\n\n');
            plainText = plainText.replace(/^\s+/gm, '');
        } catch (e) {
            console.log(e);
        }

        return plainText;
    }
    async checkEventAssociation(emailData) {
        try {
            
            if (this.shouldRefreshEventsCache()) {
                await this.refreshEventsCache();
            }

            
            const matchingEvent = this.eventsCache.find(event => {
                const emailMatches =
                    emailData.from.includes(event.email) ||
                    emailData.to.includes(event.email);
                return emailMatches;
            });

            if (matchingEvent) {
                return {
                    eventId: matchingEvent.id,
                    eventName: matchingEvent.name
                };
            }

            return {
                eventId: null,
                eventName: null
            };
        } catch (error) {
            console.error('Error checking event association:', error);
            return {
                eventId: null,
                eventName: null
            };
        }
    }
    async categorizeEmail(emailData) {
        try {
            const prompt = `
                Analyze this email and categorize it into one of these categories:
                - event: Emails related to event bookings, inquiries, or coordination
                - event_platform: Emails about the event platform itself or technical matters
                - other: Any other type of email

                Email Subject: ${emailData.subject}
                Email Content: ${emailData.text || emailData.snippet}
            `;

            const { parsedData } = await this.aiService.generateResponse(
                [{ role: 'user', content: prompt }],
                {
                    schema: this.categorySchema,
                    schemaName: 'EmailCategory',
                    provider: 'openai',
                    model: 'gpt-4o-mini-2024-07-18',
                    resetHistory: true
                }
            );

            return parsedData.category;
        } catch (error) {
            console.error('Error categorizing email:', error);
            return 'other';
        }
    }

    convertHtmlToText(html) {
        try {
            
            return html
                .replace(/<style[^>]*>.*<\/style>/gs, '') 
                .replace(/<script[^>]*>.*<\/script>/gs, '') 
                .replace(/<[^>]+>/g, ' ') 
                .replace(/&nbsp;/g, ' ') 
                .replace(/\s+/g, ' ') 
                .trim(); 
        } catch (error) {
            console.error('Error converting HTML to text:', error);
            return '';
        }
    }
    mergeEmails(cachedEmails, newEmails) {
        
        const emailMap = new Map();

        
        cachedEmails.forEach(email => emailMap.set(email.id, email));

        
        newEmails.forEach(email => emailMap.set(email.id, {
            ...email,
            replied: email.replied || false 
        }));

        
        const mergedEmails = Array.from(emailMap.values());
        return mergedEmails.sort((a, b) => {
            const dateA = Number(a.internalDate);
            const dateB = Number(b.internalDate);
            return dateB - dateA;
        });
    }
    async listAllLabels() {
        try {
            const auth = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth });

            const response = await gmail.users.labels.list({
                userId: 'me'
            });

            
            return response.data.labels.map(label => ({
                id: label.id,
                name: label.name,
                type: label.type,
                messageListVisibility: label.messageListVisibility,
                labelListVisibility: label.labelListVisibility
            }));
        } catch (error) {
            console.error('Error listing labels:', error);
            throw error;
        }
    }
    async archiveEmail(messageId) {
        try {
            const auth = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth });

            
            await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    removeLabelIds: ['INBOX'],
                    addLabelIds: ["Label_6"]
                }
            });

            
            if (this.emailCache.has(messageId)) {
                const emailData = this.emailCache.get(messageId);

                
                emailData.labels = emailData.labels || [];
                emailData.labels = emailData.labels.filter(label => label !== 'INBOX');
                if (!emailData.labels.includes('Label_6')) {
                    emailData.labels.push('Label_6');
                }

                
                this.emailCache.set(messageId, emailData);

                
                try {
                    let cachedEmails = [];
                    if (fs.existsSync(this.cacheFilePath)) {
                        cachedEmails = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8'));
                    }

                    
                    const emailIndex = cachedEmails.findIndex(email => email.id === messageId);
                    if (emailIndex !== -1) {
                        cachedEmails[emailIndex] = emailData;
                    }

                    
                    fs.writeFileSync(this.cacheFilePath, JSON.stringify(cachedEmails, null, 2), 'utf8');
                } catch (cacheError) {
                    console.error('Error updating cache file:', cacheError);
                    
                }
            }

            return true;
        } catch (error) {
            console.error('Error archiving email:', error);
            
            try {
                const auth = await this.auth.getOAuth2Client();
                const gmail = google.gmail({ version: 'v1', auth });

                await gmail.users.messages.modify({
                    userId: 'me',
                    id: messageId,
                    requestBody: {
                        removeLabelIds: ['INBOX'],
                        addLabelIds: ['Label_6']
                    }
                });

                
                if (this.emailCache.has(messageId)) {
                    const emailData = this.emailCache.get(messageId);
                    emailData.labels = emailData.labels.filter(label => label !== 'INBOX');
                    this.emailCache.set(messageId, emailData);

                    
                    try {
                        let cachedEmails = [];
                        if (fs.existsSync(this.cacheFilePath)) {
                            cachedEmails = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8'));
                        }
                        const emailIndex = cachedEmails.findIndex(email => email.id === messageId);
                        if (emailIndex !== -1) {
                            cachedEmails[emailIndex] = emailData;
                        }
                        fs.writeFileSync(this.cacheFilePath, JSON.stringify(cachedEmails, null, 2), 'utf8');
                    } catch (cacheError) {
                        console.error('Error updating cache file:', cacheError);
                    }
                }

                return true;
            } catch (fallbackError) {
                console.error('Fallback archive failed:', fallbackError);
                throw fallbackError;
            }
        }
    }
    
    updateEmailInCache(emailData) {
        
        this.emailCache.set(emailData.id, emailData);

        
        try {
            let cachedEmails = [];
            if (fs.existsSync(this.cacheFilePath)) {
                cachedEmails = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8'));
            }

            const emailIndex = cachedEmails.findIndex(email => email.id === emailData.id);
            if (emailIndex !== -1) {
                cachedEmails[emailIndex] = emailData;
            } else {
                cachedEmails.push(emailData);
            }

            
            cachedEmails.sort((a, b) => {
                const dateA = Number(a.internalDate);
                const dateB = Number(b.internalDate);
                return dateB - dateA;
            });

            fs.writeFileSync(this.cacheFilePath, JSON.stringify(cachedEmails, null, 2), 'utf8');
        } catch (error) {
            console.error('Error updating email in cache:', error);
        }
    }

    async getEmailsForContact(email) {
        try {
            
            const cachedEmails = this.loadEmailsFromCache();
            const contactEmails = cachedEmails.filter(e => {
                const fromMatch = e.from.includes(email);
                const toMatch = e.to.includes(email);
                return fromMatch || toMatch;
            });

            
            const messages = await this.listMessages({
                email: email,
                maxResults: 50
            });

            
            const allContactEmails = this.mergeEmails(contactEmails, messages);

            
            this.updateCacheWithEmails(messages);

            return allContactEmails;
        } catch (error) {
            console.error('Error getting emails for contact:', error);
            
            return this.loadEmailsFromCache().filter(e => {
                const fromMatch = e.from.includes(email);
                const toMatch = e.to.includes(email);
                return fromMatch || toMatch;
            });
        }
    }
    async getAllEmails(maxResults = 100, onlyImportant = false, forcedRefresh = false, query = null) {
        try {
            
            let cachedEmails = this.loadEmailsFromCache();

            
            const lastRetrievalDate = moment(this.loadLastRetrievalDate(), "YYYY-MM-DD HH:mm");
            const now = moment();
            const needsUpdate = !cachedEmails.length || lastRetrievalDate.isBefore(now, 'minute');

            
            if (!needsUpdate && !forcedRefresh) {
                return cachedEmails;
            }

            
            const processedMessages = await this.listMessages({
                maxResults,
                onlyImportant,
                query
            });

            
            const allEmails = this.mergeEmails(cachedEmails, processedMessages);

            
            this.saveEmailsToCache(allEmails);

            
            return allEmails.slice(0, maxResults);
        } catch (error) {
            console.error('Error getting all emails:', error);
            
            return this.loadEmailsFromCache();
        }
    }
    updateCacheWithEmails(newEmails) {
        const cachedEmails = this.loadEmailsFromCache();
        const updatedEmails = this.mergeEmails(cachedEmails, newEmails);
        this.saveEmailsToCache(updatedEmails);
    }

    async getThreadMessages(threadId) {
        try {
            const authClient = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth: authClient });
            const res = await gmail.users.threads.get({
                userId: 'me',
                id: threadId,
                format: 'full',
            });
            return res.data.messages || [];
        } catch (error) {
            console.error('Error fetching thread messages:', error);
            throw error;
        }
    }

    async forceFullRefresh() {
        try {
            
            this.lastRetrievalDate = moment().subtract(1, 'year').format('YYYY/MM/DD');
            const messages = await this.listMessages({
                maxResults: 500 
            });
            const emails = await this.processMessageBatch(messages);
            this.saveEmailsToCache(emails);
            this.saveLastRetrievalDate(); 
            return emails;
        } catch (error) {
            console.error('Error during full refresh:', error);
            throw error;
        }
    }

    clearCache() {
        try {
            this.emailCache.clear();
            if (fs.existsSync(this.cacheFilePath)) {
                fs.unlinkSync(this.cacheFilePath);
            }
        } catch (error) {
            console.error('Error clearing cache:', error);
        }
    }
}

module.exports = GmailService;

//--- File: /home/luan_ngo/web/events/services/eventService.js ---

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const GoogleCalendarService = require('./googleCalendarService');
const aiService = require('./aiService');
const moment = require('moment-timezone');
class EventService {
  constructor(googleAuth) {
    this.eventsFilePath = path.join(__dirname, '..', 'data', 'events.json');
    this.remoteApiGetUrl = 'https:
    this.remoteApiUpdateUrl = 'https:
    
    
    this.gmail = new gmailService(googleAuth);
    
    this.gmail.setEventService(this);
    
    this.calendarService = new GoogleCalendarService(googleAuth);

    this.initializeEventsFile();
}
  initializeEventsFile() {
    const dataDir = path.dirname(this.eventsFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(this.eventsFilePath)) {
      this.saveEvents({ contacts: [] });
    } else {
      try {
        const content = fs.readFileSync(this.eventsFilePath, 'utf8');
        JSON.parse(content);
      } catch (error) {
        console.error('Error reading events file, reinitializing:', error);
        this.saveEvents({ contacts: [] });
      }
    }
  }
  async getEventSummary(id) {
    try {
      
      const contact = this.getEvent(id);
      if (!contact) {
        throw new Error('Event not found');
      }

      
      const emails = await this.gmail.getEmailsForContact(contact.email);

      
      const sortedEmails = emails.sort((a, b) =>
        new Date(a.internalDate) - new Date(b.internalDate)
      );

      
      const firstEmail = sortedEmails[0];
      const emailContent = firstEmail?.text || firstEmail?.html || '';

      
      const contactSummary = {
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        startTime: contact.startTime,
        endTime: contact.endTime,
        room: Array.isArray(contact.room) ? contact.room.join(', ') : contact.room,
        attendance: contact.attendance,
        partyType: contact.partyType,
        services: Array.isArray(contact.services) ? contact.services.join(', ') : contact.services,
        notes: contact.notes
      };

      
      const prompt = `Summarize this event. In particular, tell me:
        - Event organizer (no contact info)
        - Time and date
        - Room booked
        - Number of attendees
        - Event type
        - Catering or drink packages and choices. If they choose catering or drink packages, be careful and detailed with their choices.
        - Special requests in the notes
        - When the organizer last emailed
        - Payment information (but no etransfer information).

          Respond in bullet points or short sentences.
          Be detalied about special requests by organizers. 

        Event details: ${JSON.stringify(contactSummary)}
        Recent email conversation: ${emailContent}`;

      
      const { response } = await aiService.generateResponse([

        {
          role: 'user',
          content: prompt
        }
      ], {
        includeBackground: false,
        resetHistory: true
      });

      return {
        success: true,
        summary: response,
        metadata: {
          emailCount: sortedEmails.length,
          firstEmailDate: firstEmail?.timestamp,
          lastEmailDate: sortedEmails[sortedEmails.length - 1]?.timestamp,
          contactInfo: contactSummary
        }
      };

    } catch (error) {
      console.error('Error generating event summary:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  async updateRemoteEvent(contact) {
    try {
      const response = await axios.post(this.remoteApiUpdateUrl, contact);
      const remoteEvents = response.data;
      console.log(`Updated ${remoteEvents.length} events from remote successfully`);
      return true;
    } catch (error) {
      console.error('Error updating remote events:', error);
      return false;
    }
  }
  async syncWithRemote() {
    try {
      
      const response = await axios.get(this.remoteApiGetUrl);
      const remoteEvents = response.data;

      
      let localEvents = this.loadEvents();

      
      const localEventsMap = new Map(localEvents.map(event => [event.id, event]));

      
      remoteEvents.forEach(remoteEvent => {
        const existingEvent = localEventsMap.get(remoteEvent.id);

        if (existingEvent) {
          
          
          localEventsMap.set(remoteEvent.id, { ...existingEvent, ...remoteEvent });
        } else {
          
          localEventsMap.set(remoteEvent.id, remoteEvent);
        }
      });

      
      const mergedEvents = Array.from(localEventsMap.values());
      this.saveEvents(mergedEvents);

      console.log(`Synced ${mergedEvents.length} events successfully`);
      return true;
    } catch (error) {
      console.error('Error syncing with remote:', error);
      return false;
    }
  }

  loadEvents() {
    try {
      const data = fs.readFileSync(this.eventsFilePath, 'utf8');
      const events = JSON.parse(data);
      return events.contacts || [];
    } catch (error) {
      console.error('Error loading events:', error);
      return [];
    }
  }

  saveEvents(events) {
    try {
      
      const dataToSave = Array.isArray(events) ? { contacts: events } : events;
      fs.writeFileSync(this.eventsFilePath, JSON.stringify(dataToSave, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Error saving events:', error);
      return false;
    }
  }

  getEvent(id) {
    try {
      const events = this.loadEvents();
      return events.find(event => event.id === parseInt(id)) || null;
    } catch (error) {
      console.error('Error getting event:', error);
      return null;
    }
  }

  createEvent(eventData) {
    try {
      const events = this.loadEvents();

      
      let newId;
      if (eventData.id !== undefined && eventData.id !== null) {
        newId = parseInt(eventData.id);
        const existingEvent = events.find(event => event.id === newId);
        if (existingEvent) {
          throw new Error('Event with this ID already exists');
        }
      } else {
        
        newId = events.length > 0 ? Math.max(...events.map(e => e.id)) + 1 : 0;
      }

      const newEvent = {
        id: newId,
        name: eventData.name,
        email: eventData.email,
        phone: eventData.phone || '',
        startTime: eventData.startTime,
        endTime: eventData.endTime,
        status: Array.isArray(eventData.status) ? eventData.status.join(';') : (eventData.status || ''),
        services: Array.isArray(eventData.services) ? eventData.services.join(';') : (eventData.services || ''),
        room: Array.isArray(eventData.room) ? eventData.room.join(';') : (eventData.room || ''),
        rentalRate: eventData.rentalRate || '',
        partyType: eventData.partyType || '',
        attendance: eventData.attendance || '',
        notes: eventData.notes || ''
      };

      events.push(newEvent);
      this.saveEvents(events);
      return newEvent;
    } catch (error) {
      console.error('Error creating event:', error);
      return null;
    }
  }


  updateEvent(id, eventData) {
    try {
      const events = this.loadEvents();
      const index = events.findIndex(event => event.id === parseInt(id));

      if (index === -1) {
        
        const newEvent = { ...eventData, id: parseInt(id) };
        events.push(newEvent);
        this.saveEvents(events);
        return newEvent;
      }

      
      events[index] = {
        ...events[index],
        ...eventData,
        id: parseInt(id), 
        status: Array.isArray(eventData.status) ? eventData.status.join(';') : eventData.status,
        services: Array.isArray(eventData.services) ? eventData.services.join(';') : eventData.services,
        room: Array.isArray(eventData.room) ? eventData.room.join(';') : eventData.room
      };

      this.saveEvents(events);
      return events[index];
    } catch (error) {
      console.error('Error updating or creating event:', error);
      return null;
    }
  }


  deleteEvent(id) {
    try {
      const events = this.loadEvents();
      const filteredEvents = events.filter(event => event.id !== parseInt(id));
      return this.saveEvents(filteredEvents);
    } catch (error) {
      console.error('Error deleting event:', error);
      return false;
    }
  }
  async generateWeeklySummary() {
    try {
      
      const calendarEvents = await this.calendarService.listEvents();

      
      const localEvents = this.loadEvents();

      
      const startOfWeek = moment().tz('America/New_York').startOf('day').add(1, 'day');
      const endOfWeek = moment().tz('America/New_York').add(7, 'days').endOf('day');

      const upcomingEvents = calendarEvents.filter(event => {
        const eventStart = moment(event.start.dateTime || event.start.date);
        return eventStart.isBetween(startOfWeek, endOfWeek);
      });

      if (upcomingEvents.length === 0) {
        const noEventsEmail = {
          subject: 'Weekly Event Summary - No Upcoming Events',
          html: 'No events scheduled for the upcoming week.'
        };

        await this.gmail.sendEmail('info@eattaco.ca', noEventsEmail.subject, noEventsEmail.html);
        return noEventsEmail;
      }

      let eventSummaries = [];

      
      for (const event of upcomingEvents) {
        const eventName = event.summary || 'Unnamed Event';
        const eventStart = moment(event.start.dateTime || event.start.date);
        const eventStartFormatted = eventStart.format('MMMM Do YYYY, h:mm a');
        const eventStartDate = eventStart.format('YYYY-MM-DD');

        
        const localEvent = localEvents.find(e => {
          if (typeof e.name === 'undefined') return false;
          const localEventName = e.name.toLowerCase();
          const localEventDate = moment(e.startTime).format('YYYY-MM-DD');
          return eventName.toLowerCase().includes(localEventName) &&
            localEventDate === eventStartDate;
        });

        let eventDetails = 'Event found in calendar but no matching contact details in system.';
        let cateringStatus = 'Unknown';
        let followUpMailto = '';

        if (localEvent) {
          try {
            
            const summaryResponse = await axios.get(`${process.env.HOST}/api/events/${localEvent.id}/summary`);
            eventDetails = summaryResponse.data.summary;

            
            cateringStatus = localEvent.services &&
              Array.isArray(localEvent.services) &&
              localEvent.services.includes('catering')
              ? 'Requested' : 'Not Requested';

            
            const followUpPrompt = `
                        Generate a follow-up email for an upcoming event. The email should:
                        1. Express excitement for their event
                        2. Confirm the event date and time
                        3. Ask for an updated attendee count
                        Based on the email summary, if catering is requested, a package has been picked and the individual choices(i.e. types of tacos or types of appetizers) have been picked, then confirm the choices. 
                        
                        If catering is requested and a package has been picked, but individual options (like tacos or buffet choices) have not been picked, ask for the choices. We need it about 72 hours before the event.
                        
                        If they don't mention catering, ask if they would be interested in our catering services, mentioning our $6 light appetizers option'
                        
                        4. Be concise - no more than 3-4 short paragraphs. Don't add a subject line.
                        
                        Event Summary: ${eventDetails}
                        Event Date: ${eventStartFormatted}
                        Client Name: ${localEvent.name}
                    `;

            const { response: emailContent } = await aiService.generateResponse([
              {
                role: 'system',
                content: 'You are a friendly venue coordinator writing follow-up emails.'
              },
              {
                role: 'user',
                content: followUpPrompt
              }
            ], {
              includeBackground: true,
              resetHistory: true,
              provider: 'google',
              model: 'gemini-1.5-flash'
            });


            
            const subject = `Excited for your event on ${eventStart.format('MMMM Do')}`;

            
            const encodedEmail = encodeURIComponent(localEvent.email);
            const encodedSubject = encodeURIComponent(subject);
            const encodedBody = encodeURIComponent(emailContent);

            
            followUpMailto = `mailto:${encodedEmail}?subject=${encodedSubject}&body=${encodedBody}`;

          } catch (error) {
            console.error(`Error processing event ${localEvent.id}:`, error);
            eventDetails = 'Error retrieving event details';
          }
        }

        eventSummaries.push({
          name: eventName,
          email: localEvent?.email || 'No email found',
          date: eventStartFormatted,
          details: eventDetails,
          catering: cateringStatus,
          followUpMailto: followUpMailto
        });
      }

      
      const emailHtml = `
            <h2>Weekly Event Summary</h2>
            <p>Here are the upcoming events for the next week:</p>
            ${eventSummaries.map(event => `
                <div style="margin-bottom: 30px; padding: 15px; border: 1px solid #ddd; border-radius: 5px;">
                    <h3>${event.name}</h3>
                    <p><strong>Date:</strong> ${event.date}</p>
                    <p><strong>Email:</strong> ${event.email}</p>
                    <div style="margin: 10px 0;">
                        <h4>Event Details:</h4>
                        <p>${event.details}</p>
                    </div>
                    ${event.followUpMailto ? `
                       <a href="${event.followUpMailto}" 
                          style="display: inline-block; padding: 10px 20px; 
                                background-color: #007bff; color: white; 
                                text-decoration: none; border-radius: 5px;">
                          Send Follow-up Email
                      </a>
                    ` : ''}
                </div>
            `).join('')}
        `;

      const emailData = {
        subject: `Weekly Event Summary - ${upcomingEvents.length} Upcoming Events`,
        html: emailHtml
      };

      
      await this.gmail.sendEmail('info@eattaco.ca', emailData.subject, emailData.html);

      return emailData;
    } catch (error) {
      console.error('Error generating weekly summary:', error);
      throw error;
    }
  }
}

module.exports = EventService;

//--- File: /home/luan_ngo/web/events/services/aiService.js ---
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const backgroundService = require('./BackgroundService');
const { zodResponseFormat } = require('openai/helpers/zod');
const Groq = require("groq-sdk");
const { GoogleGenerativeAI } = require('@google/generative-ai');
class AIService {
  constructor() {
    
    this.providers = {
      openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      groq: new Groq({ apiKey: process.env.GROQ_API_KEY }),
      google: new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
    };
    
    this.currentProvider = {
      name: 'openai',
      model: 'gpt-4o-mini-2024-07-18'
    };
    
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

    
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    
    this.messageHistory = [];
    this.currentConversationId = null;

    
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
            const contents = contextualizedMessages.map(msg => {
              if (typeof msg.content === 'object' && msg.content !== null) {
                msg.content = JSON.stringify(msg.content);
              }
              return {
                role: msg.role ,
               content:msg.content
              };F
            });
            const result = await this.providers.openai.chat.completions.create({
              model,
              messages: contents,
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
          const contents = contextualizedMessages.map(msg => {
            if (typeof msg.content === 'object' && msg.content !== null) {
              msg.content = JSON.stringify(msg.content);
            }
            return {
              role: msg.role === 'assistant' ? 'model' : (msg.role === 'system' ? 'user' : msg.role),
              parts: [{ text: msg.content }]
            };
          });
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

//--- File: /home/luan_ngo/web/events/routes/gmail.js ---
const express = require('express');
const router = express.Router();

module.exports = (googleAuth, gmailService) => {

    router.post('/archiveEmail/:id', async (req, res) => {
        try {
            const messageId = req.params.id;
            await gmailService.archiveEmail(messageId);
            res.json({ success: true });
        } catch (error) {
            console.error('Error archiving email:', error);
            res.status(500).json({
                error: 'Error archiving email',
                details: error.message
            });
        }
    });
    
    router.post('/sendEmail', async (req, res) => {
        try {
            const { html, to, subject } = req.body;

            if (!html || !to || !subject) {
                return res.status(400).json({
                    error: 'Missing required fields',
                    details: 'html, to, and subject are required'
                });
            }

            const result = await gmailService.sendEmail(to, subject, html);
            res.json({ success: true, messageId: result.id });
        } catch (error) {
            console.error('Error in send email route:', error);
            res.status(500).json({
                error: 'Failed to send email',
                details: error.message
            });
        }
    });
    router.get('/readGmail', async (req, res) => {
        try {
            const type = req.query.type || 'all';
            const email = req.query.email;
            const forceRefresh = req.query.forceRefresh === 'true';

            let emails;
            if (type === 'interac') {
                
                emails = await gmailService.getAllEmails(50, false, forceRefresh, "in:inbox-deposits");
                emails = emails.filter(email => {
                    const subject = email.subject?.toLowerCase() || '';
                    return subject.includes('interac');
                });
            } else if (type === 'contact' && email) {
                emails = await gmailService.getEmailsForContact(email);
            } else {
                emails = await gmailService.getAllEmails(50, false, forceRefresh);
            }

            
            if (type !== 'interac') {
                emails = emails.filter(email => email.labels.includes('INBOX'));
            }

            res.json(emails);
        } catch (error) {
            console.error('Error reading Gmail:', error);
            res.status(500).json({
                error: 'Error reading Gmail',
                details: error.message,
            });
        }
    });
    router.post('/forwardEmail', async (req, res) => {
        try {
            const { messageId, to } = req.body;
            const message = await gmailService.getMessage(messageId);

            
            await gmailService.sendEmail(
                to,
                `Fwd: ${message.payload.headers.find(h => h.name === 'Subject')?.value}`,
                message.parsedContent.html || message.parsedContent.text
            );

            res.json({ success: true });
        } catch (error) {
            console.error('Error forwarding email:', error);
            res.status(500).json({
                error: 'Error forwarding email',
                details: error.message
            });
        }
    });

    router.get('/messages/:id', async (req, res) => {
        try {
            const message = await gmailService.getMessage(req.params.id);
            const content = await gmailService.parseEmailContent(message);
            res.json({
                id: message.id,
                from: message.payload.headers.find(h => h.name === 'From')?.value || '',
                to: message.payload.headers.find(h => h.name === 'To')?.value || '',
                subject: message.payload.headers.find(h => h.name === 'Subject')?.value || '',
                timestamp: message.payload.headers.find(h => h.name === 'Date')?.value || '',
                text: content,
                labels: message.labelIds || []
            });
        } catch (error) {
            console.error('Error retrieving message:', error);
            res.status(500).json({
                error: 'Error retrieving message',
                details: error.message
            });
        }
    });

    async function checkForReplies(emails, cachedEmailMap) {
        
        const threadGroups = new Map();
        emails.forEach(email => {
            if (!email.labels.includes('SENT')) { 
                if (!threadGroups.has(email.threadId)) {
                    threadGroups.set(email.threadId, []);
                }
                threadGroups.set(email.threadId, [...threadGroups.get(email.threadId), email]);
            }
        });

        for (const [threadId, threadEmails] of threadGroups) {
            try {
                const threadMessages = await gmailService.getThreadMessages(threadId);

                
                const sentMessages = threadMessages.filter(msg => msg.labelIds.includes('SENT'));

                
                threadEmails.forEach(inboxEmail => {
                    const replied = sentMessages.some(sentMsg =>
                        parseInt(sentMsg.internalDate) > parseInt(inboxEmail.internalDate)
                    );

                    if (cachedEmailMap[inboxEmail.id]) {
                        cachedEmailMap[inboxEmail.id].replied = replied;
                    }
                });
            } catch (err) {
                console.error(`Error checking replies for thread ${threadId}:`, err);
            }
        }
    }

    return router;
};

//--- File: /home/luan_ngo/web/events/routes/events.js ---


const express = require('express');
const router = express.Router();
const EventService = require('../services/eventService');
const pdfService = require('../services/pdfService');
module.exports = (googleAuth, eventService) => {


  router.get('/api/events/weekly-summary', async (req, res) => {
    try {
      const summary = await eventService.generateWeeklySummary();
      res.json({
        message: 'Weekly summary generated and sent successfully',
        summary: summary
      });
    } catch (error) {
      console.error('Error generating weekly summary:', error);
      res.status(500).json({
        error: 'Failed to generate weekly summary',
        details: error.message
      });
    }
  });
  router.post('/api/createEventContract', async (req, res) => {
    const data = req.body
    const contractData = await pdfService.createEventContract(data, res);
  });

  router.get('/api/events/:id/summary', async (req, res) => {
    try {
      const summary = await eventService.getEventSummary(req.params.id);

      if (!summary.success) {
        return res.status(500).json({ error: summary.error });
      }


      res.json(summary);
    } catch (error) {
      console.error('Error getting event summary:', error);
      res.status(500).json({ error: 'Failed to generate event summary' });
    }
  });
  
  router.get('/api/events', (req, res) => {
    try {
      const events = eventService.loadEvents();
      res.json(events);
    } catch (error) {
      console.error('Error getting events:', error);
      res.status(500).json({ error: 'Failed to get events' });
    }
  });

  
  router.get('/api/events/:id', (req, res) => {
    try {
      const event = eventService.getEvent(req.params.id);
      if (event) {
        res.json(event);
      } else {
        res.status(404).json({ error: 'Event not found' });
      }
    } catch (error) {
      console.error('Error getting event:', error);
      res.status(500).json({ error: 'Failed to get event' });
    }
  });

  
  router.post('/api/events/sync', async (req, res) => {
    try {
      const success = await eventService.syncWithRemote();
      if (success) {
        res.json({ message: 'Sync completed successfully' });
      } else {
        res.status(500).json({ error: 'Sync failed' });
      }
    } catch (error) {
      console.error('Error during sync:', error);
      res.status(500).json({ error: 'Sync failed' });
    }
  });

  
  router.put('/api/events/:id', async (req, res) => {
    try {
      
      const requiredFields = ['name', 'email', 'startTime', 'endTime'];
      for (const field of requiredFields) {
        if (!req.body[field]) {
          return res.status(400).json({ error: `Missing required field: ${field}` });
        }
      }

      let updatedEvent = eventService.updateEvent(req.params.id, req.body);

      if (updatedEvent) {
        await eventService.updateRemoteEvent(updatedEvent, req.body);
        res.json(updatedEvent);
      } else {
        
        const newEventData = { ...req.body, id: parseInt(req.params.id) };
        const newEvent = eventService.createEvent(newEventData);

        if (newEvent) {
          res.status(201).json(newEvent);
        } else {
          res.status(500).json({ error: 'Failed to create event' });
        }
      }
    } catch (error) {
      console.error('Error updating or creating event:', error);
      res.status(500).json({ error: 'Failed to update or create event' });
    }
  });

  
  router.post('/api/events', (req, res) => {
    try {
      
      const requiredFields = ['name', 'email', 'startTime', 'endTime'];
      for (const field of requiredFields) {
        if (!req.body[field]) {
          return res.status(400).json({ error: `Missing required field: ${field}` });
        }
      }

      const newEvent = eventService.createEvent(req.body);
      if (newEvent) {
        res.status(201).json(newEvent);
      } else {
        res.status(500).json({ error: 'Failed to create event' });
      }
    } catch (error) {
      console.error('Error creating event:', error);
      res.status(500).json({ error: 'Failed to create event' });
    }
  });

  
  router.delete('/api/events/:id', (req, res) => {
    try {
      const success = eventService.deleteEvent(req.params.id);
      if (success) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: 'Event not found' });
      }
    } catch (error) {
      console.error('Error deleting event:', error);
      res.status(500).json({ error: 'Failed to delete event' });
    }
  });
  return router;
}

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

    
    let conversationHistory = aiService.loadConversations();

    
    conversationHistory.push(...messages);

    
    const aiResponse = await aiService.generateResponse(conversationHistory);

    
    conversationHistory.push({ role: 'assistant', content: aiResponse });

    
    aiService.saveConversationHistory(conversationHistory);

    res.json({ response: aiResponse });
  } catch (error) {
    res.status(500).json({ error: 'AI service error' });
  }
});
router.post('/analyzeEventUpdate', async (req, res) => {
  try {
      const { eventDetails, emailContent } = req.body;
      
      const prompt = `
          Read only the most recent email in the email chain. 

          Current Event Details:
          ${JSON.stringify(eventDetails, null, 2)}
          
          New Email Content:
          ${emailContent}
          
          Provide a concise but summary of what should be added to the event notes.
          Focus on any changes to: attendance, catering preferences, drink selections, setup requests, 
          timing details, or special accommodations. Only respond with the organizers requets, no introduction. 
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

      res.json({ 
          success: true,
          summary: response
      });

  } catch (error) {
      console.error('Error analyzing event update:', error);
      res.status(500).json({
          success: false,
          error: error.message
      });
  }
});

router.post('/reset', (req, res) => {
  aiService.saveConversationHistory([]);
  res.json({ message: 'Conversation history reset' });
});

module.exports = router;


//--- File: /home/luan_ngo/web/events/app.js ---


const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const GoogleAuth = require('./services/GoogleAuth');
const EmailProcessorServer = require('./services/EmailProcessorServer');
const backgroundRoutes = require('./routes/BackgroundRoutes');
const GmailService = require('./services/gmailService');
const EventService = require('./services/eventService');


const googleAuth = new GoogleAuth();
const emailProcessor = new EmailProcessorServer(googleAuth);


const app = express();

const gmailService = new GmailService(googleAuth);
const eventService = new EventService(googleAuth);


gmailService.setEventService(eventService);
eventService.setGmailService(gmailService);


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); 
app.use(session({
  secret: 'yourSecretKey',
  resave: false,
  saveUninitialized: true,
}));


const oauthRoutes = require('./routes/oauth')(googleAuth);
const gmailRoutes = require('./routes/gmail')(googleAuth, gmailService);
const calendarRoutes = require('./routes/calendar')(googleAuth);
const eventsRoutes = require('./routes/events')(googleAuth, eventService);
const aiRoutes = require('./routes/ai');



app.use('/auth', oauthRoutes);
app.use('/gmail', gmailRoutes);
app.use('/', eventsRoutes);
app.use('/calendar', calendarRoutes);
app.use('/ai', aiRoutes);
app.use('/', emailProcessor.getRouter());
app.use('/', backgroundRoutes);  



app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html')); 
});


const PORT = 3003;
app.listen(PORT, () => {
  console.log(`Server is running on http:
});

module.exports = app;

