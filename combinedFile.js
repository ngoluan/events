
//--- File: /home/luan_ngo/web/events/services/pdfService.js ---
const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

class PDFService {
    async createEventContract(data, res) {
        try {
            const inputPath = path.resolve("./public/files/Event Contract.pdf");
            
            
            const sanitizedDate = data.reservationDate.replace(/[\/-]/g, "_");
            const sanitizedName = data.contactName.replace(/ /g, "");
            const outputFileName = `EventContract_${sanitizedDate}_${sanitizedName}.pdf`;
            const outputPath = path.resolve("./public/files", outputFileName);

            await this.createPdf(inputPath, outputPath, data);
            res.send(true);
        } catch (error) {
            console.error('Error creating event contract:', error);
            res.status(500).send({ error: 'Failed to create event contract' });
        }
    }

    removeUnsupportedCharacters(text) {
        return text.replace(/[^\x00-\x7F]/g, "");
    }

    async createPdf(input, output, data) {
        try {
            
            const file = await fs.readFile(input);
            
            
            const pdfDoc = await PDFDocument.load(file);
            const form = pdfDoc.getForm();

            
            const fields = form.getFields();
            fields.forEach(field => {
                console.log('Available field:', field.getName());
            });

            
            const checks = ["dj", "band", "bar", "audio", "music", "kareoke", "lights", "catering", "drink"];
            
            for (const [key, value] of Object.entries(data)) {
                if (key === "clientSign") continue;

                try {
                    if (checks.includes(key)) {
                        const field = form.getCheckBox(key);
                        if (value === "true" || value === true) {
                            field.check();
                        }
                    } else {
                        const field = form.getTextField(key);
                        const cleanText = this.removeUnsupportedCharacters(value);
                        field.setText(cleanText);
                    }
                } catch (fieldError) {
                    console.warn(`Warning: Could not process field "${key}":`, fieldError.message);
                }
            }

            
            const outputDir = path.dirname(output);
            await fs.mkdir(outputDir, { recursive: true });

            
            const pdfBytes = await pdfDoc.save();
            await fs.writeFile(output, pdfBytes);

        } catch (error) {
            console.error('Error processing PDF:', error);
            throw new Error(`Failed to process PDF: ${error.message}`);
        }
    }
}

module.exports = new PDFService();

//--- File: /home/luan_ngo/web/events/services/googleCalendarService.js ---

const { google } = require('googleapis');
const path = require('path');

class GoogleCalendarService {
  constructor(auth) {
    this.auth = auth; 
  }

  async listEvents() {
    
    const authClient = await this.auth.getOAuth2Client();
    const calendar = google.calendar({ version: 'v3', auth: authClient });
    
    
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: twoMonthsAgo.toISOString(),
      maxResults: 2500,
      singleEvents: true,
      orderBy: 'startTime',
    });
    return res.data.items || [];
  }
  async addEvent(eventData) {
    
    const authClient = await this.auth.getOAuth2Client();
    const calendar = google.calendar({ version: 'v3', auth: authClient });
    const event = {
      summary: `Event: ${eventData.name}`,
      location: eventData.location || '',
      description: eventData.notes || '',
      start: {
        dateTime: eventData.startTime,
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: eventData.endTime,
        timeZone: 'America/New_York',
      },
    };
    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });
    return res.data;
  }
}

module.exports = GoogleCalendarService;


//--- File: /home/luan_ngo/web/events/services/gmailService.js ---
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const cheerio = require('cheerio');
const { z } = require('zod');

class GmailService {
    constructor(auth, eventService = null) {
        this.auth = auth;
        this.cacheFilePath = path.join(__dirname, '..', 'data', 'emails.json');
        this.lastRetrievalPath = path.join(__dirname, '..', 'data', 'lastRetrieval.json');

        
        
        this.emailCache = new Map();
        this.messageCache = new Map(); 
        this.eventsCache = [];
        this.emailToEventMap = new Map();
        this.threadCache = new Map(); 

        
        this.lastEventsCacheUpdate = 0;
        this.lastRetrievalDate = this.loadLastRetrievalDate();

        
        this.aiService = require('./aiService');
        this.eventService = eventService;

        
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        
        this.loadEmailsFromCache();
    }

    setEventService(eventService) {
        this.eventService = eventService;
        this.refreshEventsCache();
    }
    async refreshEventsCache() {
        if (this.eventService) {
            this.eventsCache = this.eventService.loadEvents();

            
            this.emailToEventMap.clear();
            this.eventsCache
                .filter(event => event.email && event.email.trim() !== '')
                .forEach(event => {
                    this.emailToEventMap.set(event.email.toLowerCase().trim(), event);
                });

            this.lastEventsCacheUpdate = Date.now();
        }
    }


    
    shouldRefreshEventsCache() {
        const CACHE_LIFETIME = 5 * 60 * 1000; 
        return Date.now() - this.lastEventsCacheUpdate > CACHE_LIFETIME;
    }
    
    async formatReplyContent(content, originalMessage) {
        
        const headers = originalMessage.payload.headers;
        const originalDate = headers.find(h => h.name === 'Date')?.value;
        const originalFrom = headers.find(h => h.name === 'From')?.value;
        const originalContent = originalMessage.parsedContent.html ||
            originalMessage.parsedContent.text ||
            headers.find(h => h.name === 'snippet')?.value;

        
        const quotedContent = `
        <div style="margin-top: 20px;">
            <div style="padding: 10px 0;">On ${originalDate}, ${originalFrom} wrote:</div>
            <blockquote style="margin:0 0 0 0.8ex; border-left:2px #ccc solid; padding-left:1ex;">
                ${originalContent}
            </blockquote>
        </div>
    `;

        
        if (content.includes('</body>')) {
            return content.replace('</body>', `${quotedContent}</body>`);
        }

        
        return `
        <div>
            ${content}
            ${quotedContent}
        </div>
    `;
    }
    async sendEmail(to, subject, content, options = {}) {
        try {
            const authClient = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth: authClient });

            
            const isReply = options.replyToMessageId ||
                options.source === 'draftEventSpecificEmail' ||
                options.source === 'generateConfirmationEmail' ||
                options.source === 'sendToAiTextArea';

            
            let threadId = null;
            let originalMessageId = null;
            if (isReply && options.replyToMessageId) {
                const originalMessage = await this.getMessage(options.replyToMessageId);
                threadId = originalMessage.threadId;
                const headers = originalMessage.payload.headers;
                originalMessageId = headers.find(h => h.name === 'Message-ID')?.value;
            }

            
            const headers = [
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=UTF-8',
                `From: ${options.from || 'me'}`,
                `To: ${to}`,
                `Subject: =?UTF-8?B?${Buffer.from(isReply ? (subject.startsWith('Re:') ? subject : `Re: ${subject}`) : subject).toString('base64')}?=`
            ];

            
            if (originalMessageId) {
                headers.push(`In-Reply-To: ${originalMessageId}`);
                headers.push(`References: ${originalMessageId}`);
            }

            
            const formattedContent = this.formatEmailContent(content);

            
            const emailContent = `${headers.join('\r\n')}\r\n\r\n${formattedContent}`;

            
            const encodedMessage = Buffer.from(emailContent)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\
                .replace(/=+$/, '');

            
            const res = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedMessage,
                    ...(threadId && { threadId })
                }
            });

            
            if (options.replyToMessageId) {
                const emailData = this.emailCache.get(options.replyToMessageId);
                if (emailData) {
                    emailData.replied = true;
                    await this.updateEmailInCache(emailData);
                }
            }

            return {
                success: true,
                messageId: res.data.id,
                threadId: res.data.threadId,
                isReply: !!originalMessageId
            };

        } catch (error) {
            console.error('Error sending email:', error);
            throw new Error(`Failed to send email: ${error.message}`);
        }
    }

    formatEmailContent(content) {
        
        let cleanContent = content
            .replace(/<html>.*?<body>/gs, '')
            .replace(/<\/body>.*?<\/html>/gs, '')
            .trim();

        
        cleanContent = cleanContent
            .replace(/<br\s*\/?>/gi, '<br>')
            .replace(/\n/g, '<br>')
            .replace(/<br\s*\/?>(\s*<br\s*\/?>)+/gi, '<br><br>');

        
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        line-height: 1.6;
                        color: #333;
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 20px;
                    }
                    p {
                        margin-bottom: 1em;
                    }
                    a {
                        color: #0066cc;
                        text-decoration: none;
                    }
                    a:hover {
                        text-decoration: underline;
                    }
                    .signature {
                        margin-top: 20px;
                        padding-top: 20px;
                        border-top: 1px solid #eee;
                        color: #666;
                    }
                </style>
            </head>
            <body>
                ${cleanContent}
            </body>
            </html>
        `.trim();
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
    async forwardEmail(messageId, to) {
        try {
            const originalMessage = await this.getMessage(messageId);
            const originalHeaders = originalMessage.payload.headers;
            const subject = originalHeaders.find(h => h.name === 'Subject')?.value;
            const content = originalMessage.parsedContent.html || originalMessage.parsedContent.text;

            const forwardedContent = `
                <div>
                    ---------- Forwarded message ----------<br>
                    From: ${originalHeaders.find(h => h.name === 'From')?.value}<br>
                    Date: ${originalHeaders.find(h => h.name === 'Date')?.value}<br>
                    Subject: ${subject}<br>
                    To: ${originalHeaders.find(h => h.name === 'To')?.value}<br>
                    <br>
                    ${content}
                </div>
            `;

            return await this.sendEmail(to, `Fwd: ${subject}`, forwardedContent);
        } catch (error) {
            console.error('Error forwarding email:', error);
            throw error;
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

    async checkIfReplied(inboxMessage) {
        try {
            const threadId = inboxMessage.threadId;

            
            let threadMessages = this.threadCache.get(threadId);
            if (!threadMessages) {
                threadMessages = await this.getThreadMessages(threadId);
                this.threadCache.set(threadId, threadMessages);
            }

            
            const sentMessages = threadMessages.filter(msg => msg.labelIds.includes('SENT'));

            const messageId = inboxMessage.payload.headers.find(h => h.name === 'Message-ID')?.value || '';

            const hasReply = sentMessages.some(sentMessage => {
                const inReplyTo = sentMessage.payload.headers.find(h => h.name === 'In-Reply-To')?.value || '';
                const references = sentMessage.payload.headers.find(h => h.name === 'References')?.value || '';

                if (messageId && (inReplyTo.includes(messageId) || references.includes(messageId))) {
                    return true;
                }

                const sentDate = new Date(Number(sentMessage.internalDate));
                const inboxDate = new Date(Number(inboxMessage.internalDate));

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
            
            if (this.messageCache.has(messageId)) {
                return this.messageCache.get(messageId);
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
            this.messageCache.set(messageId, fullMessage);

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

    async categorizeEmail(emailData) {
        try {
            const categories = this.user.settings.emailCategories;
            const prompt = `
                Analyze this email and categorize it into one of these categories: ${categories.join(', ')}
                
                Email Subject: ${emailData.subject}
                Email Content: ${emailData.text || emailData.snippet}
            `;

            const categorySchema = this.user.getCategorySchema();

            const { parsedData } = await this.aiService.generateResponse(
                [{ role: 'user', content: prompt }],
                {
                    schema: categorySchema,
                    schemaName: 'EmailCategory',
                    resetHistory: true
                }
            );

            return parsedData.category;
        } catch (error) {
            console.error('Error categorizing email:', error);
            return 'other';
        }
    }
    async processMessageBatch(messages) {
        if (!messages || !messages.length) return [];

        const asyncLib = require('async');
        let processedEmails = [];

        await asyncLib.eachLimit(messages, 5, async (message) => {
            try {
                
                if (this.emailCache.has(message.id)) {
                    
                    processedEmails.push(this.emailCache.get(message.id));
                    return; 
                }

                
                const fullMessage = await this.getMessage(message.id);

                
                const emailData = await this.processEmail(fullMessage);

                
                this.emailCache.set(message.id, emailData);
                processedEmails.push(emailData);
            } catch (err) {
                console.error(`Error processing message ID ${message.id}:`, err);
            }
        });

        return processedEmails.sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
    }
    async processEmail(fullMessage) {
        let emailData;

        if (fullMessage?.payload?.headers) {
            
            const headers = fullMessage.payload.headers;
            const replied = await this.checkIfReplied(fullMessage);

            emailData = {
                id: fullMessage.id,
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
            
            const replied = await this.checkIfReplied(fullMessage);

            emailData = {
                id: fullMessage.id || '',
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
                replied,
                category: 'other',
                associatedEventId: null,
                associatedEventName: null
            };

            
            const [eventAssociation, category] = await Promise.all([
                this.checkEventAssociation(emailData),
                this.categorizeEmail(emailData)
            ]);

            
            emailData.associatedEventId = eventAssociation.eventId;
            emailData.associatedEventName = eventAssociation.eventName;
            emailData.category = category;
        }

        return emailData;
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

            
            const fromEmail = emailData.from.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0]?.toLowerCase();
            const toEmail = emailData.to.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0]?.toLowerCase();

            
            let matchingEvent = null;
            if (fromEmail && this.emailToEventMap.has(fromEmail)) {
                matchingEvent = this.emailToEventMap.get(fromEmail);
            } else if (toEmail && this.emailToEventMap.has(toEmail)) {
                matchingEvent = this.emailToEventMap.get(toEmail);
            }

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

        
        cachedEmails.forEach(email => {
            emailMap.set(email.id, {
                ...email,
                
                hasNotified: email.hasNotified || false,
                category: email.category || 'other',
                processedForSuggestions: email.processedForSuggestions || false
            });
        });

        
        newEmails.forEach(email => {
            const existingEmail = emailMap.get(email.id);
            emailMap.set(email.id, {
                ...(existingEmail || {}),  
                ...email,  
                
                replied: email.replied || existingEmail?.replied || false,
                hasNotified: existingEmail?.hasNotified || false,
                category: email.category || existingEmail?.category || 'other',
                processedForSuggestions: existingEmail?.processedForSuggestions || false,
                
                associatedEventId: email.associatedEventId || existingEmail?.associatedEventId,
                associatedEventName: email.associatedEventName || existingEmail?.associatedEventName
            });
        });

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
    
    async updateEmailInCache(emailData) {
        
        this.emailCache.set(emailData.id, {
            ...emailData,
            hasNotified: emailData.hasNotified || false
        });

        try {
            let cachedEmails = [];
            if (fs.existsSync(this.cacheFilePath)) {
                cachedEmails = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8'));
            }

            const emailIndex = cachedEmails.findIndex(email => email.id === emailData.id);
            if (emailIndex !== -1) {
                cachedEmails[emailIndex] = {
                    ...emailData,
                    hasNotified: emailData.hasNotified || false
                };
            } else {
                cachedEmails.push({
                    ...emailData,
                    hasNotified: emailData.hasNotified || false
                });
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

            
            const authClient = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth: authClient });
            let queryStr = 'in:inbox';
            if (query) {
                queryStr += ` ${query}`;
            }
            const response = await gmail.users.messages.list({
                userId: 'me',
                maxResults,
                q: queryStr,
                orderBy: 'internalDate desc'
            });

            const messageList = response.data.messages || [];

            
            const messagesToProcess = [];
            const processedEmails = [];

            for (const message of messageList) {
                if (this.emailCache.has(message.id)) {
                    processedEmails.push(this.emailCache.get(message.id));
                } else {
                    messagesToProcess.push(message);
                }
            }

            
            const newEmails = await this.processMessageBatch(messagesToProcess);

            
            const allEmails = this.mergeEmails(cachedEmails, newEmails);

            
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
const Utils = require('./Utils');

class EventService {
  constructor(googleAuth) {
    this.eventsFilePath = path.join(__dirname, '..', 'data', 'events.json');
    this.remoteApiGetUrl = 'https:
    this.remoteApiUpdateUrl = 'https:
    this.calendarService = new GoogleCalendarService(googleAuth);

    
    this.gmailService = null;

    this.initializeEventsFile();
  }

  
  setGmailService(gmailService) {
    this.gmailService = gmailService;
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

      
      const emails = await this.gmailService.getEmailsForContact(contact.email);

      
      const sortedEmails = emails.sort((a, b) =>
        new Date(a.internalDate) - new Date(b.internalDate)
      );

      
      const firstEmail = sortedEmails[0];
      const emailContent = firstEmail?.text || firstEmail?.html || '';
      const cleanedemailContent = Utils.cleanEmailContent(emailContent);

      
      const contactSummary = {
        id: contact.id || null,
        name: contact.name || '',
        email: contact.email || '',
        phone: contact.phone || '',
        startTime: contact.startTime || '',
        endTime: contact.endTime || '',
        status: Array.isArray(contact.status) ? contact.status.join(', ') : contact.status || '',
        services: Array.isArray(contact.services) ? contact.services.join(', ') : contact.services || '',
        room: Array.isArray(contact.room) ? contact.room.join(', ') : contact.room || '',
        rentalRate: contact.rentalRate || '',
        minSpend: contact.minSpend || '',
        partyType: contact.partyType || '',
        attendance: contact.attendance || '',
        notes: contact.notes || '',
        createdAt: contact.createdAt || ''  
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
        - Payment information (but no etransfer information). Give the total fee but warn that if there is catering or drink packages, then the fee would be different.

          Respond in bullet points or short sentences.
          Be detalied about special requests by organizers. 

        Event details: ${JSON.stringify(contactSummary)}
        Recent email conversation: ${cleanedemailContent}`;

      
      const { response } = await aiService.generateResponse([

        {
          role: 'user',
          content: prompt
        }
      ], {
        includeBackground: false,
        resetHistory: true,
        provider: 'google',
        model: 'gemini-1.5-flash'
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

        await this.gmailService.sendEmail('info@eattaco.ca', noEventsEmail.subject, noEventsEmail.html);
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

      
      await this.gmailService.sendEmail('info@eattaco.ca', emailData.subject, emailData.html);

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

  resetHistory(save = true) {
    this.messageHistory = [];
    this.currentConversationId = Date.now().toString();

    if (save) {
      this.saveConversations();
    }

    return this.currentConversationId;
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

      if (resetHistory)
        this.resetHistory();

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
                role: msg.role,
                content: msg.content
              }; F
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

//--- File: /home/luan_ngo/web/events/services/Utils.js ---

class Utils {
    static cleanEmailContent(emailContent) {
        if (!emailContent) return '';
        
        return emailContent
            
            .replace(/TacoTaco Events Team[\s\S]*?eattaco\.ca/g, '')
            .replace(/Founder and Director[\s\S]*?@drdinakulik/g, '')
            
            .replace(/^[>\s>>>>>]+/gm, '')  
            .replace(/^[>]+\s*/gm, '')      
            
            .replace(/On.*wrote:$/gm, '')
            .replace(/From:.*$/gm, '')
            .replace(/Subject:.*$/gm, '')
            .replace(/Date:.*$/gm, '')
            .replace(/Sent:.*$/gm, '')
            .replace(/----- Original Message -----/g, '')
            .replace(/-{3,}/g, '')          
            
            .replace(/Original Message[- ]*$/gm, '')
            .replace(/_{3,}/g, '')          
            
            .replace(/<[^>]+>/g, '')
            .replace(/https?:\/\/[^\s]+/g, '')
            
            .replace(/\(\d{3}\)\s*\d{3}-\d{4}/g, '')
            
            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
            
            .replace(/[\r\n]+/g, '\n')
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .replace(/\s{2,}/g, ' ')        
            .trim();
    }
}

module.exports = Utils;

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

//--- File: /home/luan_ngo/web/events/services/HistoryManager.js ---
const fs = require('fs');
const path = require('path');

class HistoryManager {
    constructor() {
        this.historyFilePath = path.join(__dirname, '..', 'data', 'history.json');
        this.maxEntries = 1000; 
        this.initializeHistory();
    }

    initializeHistory() {
        const dataDir = path.dirname(this.historyFilePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        if (!fs.existsSync(this.historyFilePath)) {
            this.saveHistory([]);
        }
    }

    loadHistory() {
        try {
            const history = JSON.parse(fs.readFileSync(this.historyFilePath, 'utf8'));
            return Array.isArray(history) ? history : [];
        } catch (error) {
            console.error('Error loading history:', error);
            return [];
        }
    }

    saveHistory(history) {
        try {
            fs.writeFileSync(this.historyFilePath, JSON.stringify(history, null, 2));
        } catch (error) {
            console.error('Error saving history:', error);
        }
    }

    addEntry(entry) {
        try {
            const history = this.loadHistory();
            const newEntry = {
                ...entry,
                timestamp: new Date().toISOString(),
                id: Date.now().toString() 
            };

            history.push(newEntry);
            
            
            const trimmedHistory = history.slice(-this.maxEntries);
            this.saveHistory(trimmedHistory);

            return newEntry;
        } catch (error) {
            console.error('Error adding history entry:', error);
            return null;
        }
    }

    getEntries(filters = {}) {
        try {
            const history = this.loadHistory();
            let filteredHistory = [...history];

            
            if (filters.type) {
                filteredHistory = filteredHistory.filter(entry => entry.type === filters.type);
            }
            if (filters.startDate) {
                filteredHistory = filteredHistory.filter(entry => 
                    new Date(entry.timestamp) >= new Date(filters.startDate)
                );
            }
            if (filters.endDate) {
                filteredHistory = filteredHistory.filter(entry => 
                    new Date(entry.timestamp) <= new Date(filters.endDate)
                );
            }

            return filteredHistory;
        } catch (error) {
            console.error('Error getting history entries:', error);
            return [];
        }
    }

    getEntryById(id) {
        try {
            const history = this.loadHistory();
            return history.find(entry => entry.id === id);
        } catch (error) {
            console.error('Error getting history entry:', error);
            return null;
        }
    }

    getRecentEntriesByType(type, limit = 10) {
        try {
            const history = this.loadHistory();
            return history
                .filter(entry => entry.type === type)
                .slice(-limit);
        } catch (error) {
            console.error('Error getting recent history entries:', error);
            return [];
        }
    }

    clearHistory() {
        try {
            this.saveHistory([]);
            return true;
        } catch (error) {
            console.error('Error clearing history:', error);
            return false;
        }
    }
}

module.exports = new HistoryManager();

//--- File: /home/luan_ngo/web/events/services/GoogleAuth.js ---
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const dotenv = require('dotenv');
dotenv.config();

class GoogleAuth {
    constructor() {
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https:
        this.tokenPath = path.join(__dirname, '../data/token.json');
        this.token = this.loadToken();
    }

    generateAuthUrl() {
        const oAuth2Client = new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );

        return oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https:
                'https:
                'https:
                'https:
                'https:
                'https:
            ]
        });
    }

    async getOAuth2Client() {
        if (!this.clientId || !this.clientSecret) {
            throw new Error('Missing Google OAuth credentials. Check your environment variables.');
        }

        const oAuth2Client = new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );

        if (!this.token) {
            throw new Error('No authentication token found. Please authenticate first.');
        }

        if (this.shouldRefreshToken(this.token)) {
            try {
                const newToken = await this.refreshToken(oAuth2Client, this.token);
                this.token = newToken;
                await this.saveToken(newToken);
            } catch (error) {
                console.error('Error refreshing token:', error);
                throw error;
            }
        }

        oAuth2Client.setCredentials(this.token);
        return oAuth2Client;
    }

    async handleCallback(code) {
        try {
            const oAuth2Client = new google.auth.OAuth2(
                this.clientId,
                this.clientSecret,
                this.redirectUri
            );

            const { tokens } = await oAuth2Client.getToken(code);
            
            
            oAuth2Client.setCredentials(tokens);
            const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
            const profile = await gmail.users.getProfile({ userId: 'me' });
            
            
            tokens.email = profile.data.emailAddress;
            await this.saveToken(tokens);
            this.token = tokens;

            return { 
                success: true, 
                email: profile.data.emailAddress 
            };
        } catch (error) {
            console.error('Error in handleCallback:', error);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    shouldRefreshToken(token) {
        if (!token.expiry_date) return true;
        return token.expiry_date - Date.now() <= 5 * 60 * 1000; 
    }

    async refreshToken(oAuth2Client, token) {
        try {
            oAuth2Client.setCredentials({
                refresh_token: token.refresh_token
            });

            const { credentials } = await oAuth2Client.refreshAccessToken();
            return { ...credentials, email: token.email };
        } catch (error) {
            console.error('Error refreshing token:', error);
            throw error;
        }
    }

    loadToken() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                return JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading token:', error);
        }
        return null;
    }

    async saveToken(token) {
        try {
            const tokenDir = path.dirname(this.tokenPath);
            if (!fs.existsSync(tokenDir)) {
                fs.mkdirSync(tokenDir, { recursive: true });
            }
            await fs.promises.writeFile(
                this.tokenPath, 
                JSON.stringify(token, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('Error saving token:', error);
            throw error;
        }
    }

    async revokeAccess() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                await fs.promises.unlink(this.tokenPath);
                this.token = null;
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error revoking access:', error);
            throw error;
        }
    }
}


module.exports = GoogleAuth;

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


//--- File: /home/luan_ngo/web/events/services/BackgroundService.js ---


const fs = require('fs');
const path = require('path');

class BackgroundService {
    constructor() {
        this.backgroundFilePath = path.join(__dirname, '..', 'data', 'background.json');
        this.initializeBackgroundFile();
    }

    initializeBackgroundFile() {
        const dataDir = path.join(__dirname, '..', 'data');
        
        
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        
        if (!fs.existsSync(this.backgroundFilePath)) {
            this.saveBackground('');
        }
    }

    getBackground() {
        try {
            const data = fs.readFileSync(this.backgroundFilePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error reading background info:', error);
            return { backgroundInfo: '' };
        }
    }

    saveBackground(backgroundInfo) {
        try {
            fs.writeFileSync(
                this.backgroundFilePath, 
                JSON.stringify({ backgroundInfo }, null, 2),
                'utf8'
            );
            return true;
        } catch (error) {
            console.error('Error saving background info:', error);
            return false;
        }
    }
}

module.exports = new BackgroundService();

//--- File: /home/luan_ngo/web/events/routes/oauth.js ---

const express = require('express');
const cors = require('cors');

module.exports = (googleAuth) => {
  const router = express.Router();

  router.use(cors({
    origin: process.env.GOOGLE_REDIRECT_URI || 'https:
    credentials: true
  }));

  router.get('/google', (req, res) => {
    try {
      const authUrl = googleAuth.generateAuthUrl();
      res.json({ authUrl });
    } catch (error) {
      console.error('Error generating auth URL:', error);
      res.redirect(`${process.env.GOOGLE_REDIRECT_URI || 'https:
    }
  });

  router.get('/google/callback', async (req, res) => {
    const code = req.query.code;
    const frontendUrl = process.env.GOOGLE_REDIRECT_URI || 'https:

    if (!code) {
      return res.redirect(`${frontendUrl}?oauth=error&message=No_authorization_code`);
    }

    try {
      const result = await googleAuth.handleCallback(code);
      if (result.success) {
        req.session.userEmail = result.email;
        res.redirect(`https:
      } else {
        throw new Error(result.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('Error handling OAuth callback:', error);
      res.redirect(`${frontendUrl}?oauth=error&message=${encodeURIComponent(error.message)}`);
    }
  });

  return router;
};


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
            const { html, to, subject, replyToMessageId, source } = req.body;

            if (!html || !to || !subject) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    details: 'html, to, and subject are required'
                });
            }

            const result = await gmailService.sendEmail(to, subject, html, {
                replyToMessageId,
                source
            });

            res.json({
                success: true,
                messageId: result.messageId,
                threadId: result.threadId,
                isReply: result.isReply
            });
        } catch (error) {
            console.error('Error in send email route:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    router.get('/readGmail', async (req, res) => {
        try {
            const type = req.query.type || 'all';
            const email = req.query.email;
            const forceRefresh = req.query.forceRefresh === 'true';
            const count = req.query.count || 25;

            let emails;
            if (type === 'interac') {
                
                emails = await gmailService.getAllEmails(count, false, forceRefresh, "in:inbox-deposits");
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

//--- File: /home/luan_ngo/web/events/routes/calendar.js ---

const express = require('express');
const router = express.Router();
const googleCalendarService = require('../services/googleCalendarService');

module.exports = (googleAuth) => {
  
  const calendarService = new googleCalendarService(googleAuth);

  router.get('/getEventCalendar', async (req, res) => {
    try {
      const events = await calendarService.listEvents();
      res.json(events);
    } catch (error) {
      console.error('Error fetching events from Google Calendar:', error);
      res.status(500).send('Error fetching events from Google Calendar');
    }
  });

  router.post('/calendar/events', async (req, res) => {
    const eventData = req.body;
    try {
      const event = await calendarService.addEvent(eventData);
      res.json(event);
    } catch (error) {
      console.error('Error adding event to calendar:', error);
      res.status(500).send('Error adding event to calendar');
    }
  });

  return router;
};


//--- File: /home/luan_ngo/web/events/routes/ai.js ---

const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');


router.post('/chat', async (req, res) => {
  const { message, provider } = req.body;
  try {
    
    if (provider) {
      aiService.setProvider(provider);
    }

    
    const aiResponse = await aiService.generateResponse([
      {role:'user',
        content:message
      }
    ],
      {
        provider: 'google',
        model: 'gemini-1.5-flash'
      }
    );

    res.json({ response: aiResponse.response });
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

router.get('/resetHistory', (req, res) => {
  aiService.resetHistory([]);
  res.json({ message: 'Conversation history reset' });
});

module.exports = router;


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
        text += ` Email: ${email}`;
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

        $(document).on("click", ".contactBtn", (e) => {
            e.preventDefault();
            $('html, body').animate({ scrollTop: $('#info').offset().top }, 500);
            this.loadContact($(e.target).parent().data("id"));
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
          await this.emailProcessor.setupUserSettings();
          const emailCategories = await this.emailProcessor.userSettings.loadSettings();
      
          const categoryRows = Object.entries(emailCategories.emailCategories).map(([name, description], index) => `
            <tr>
              <td>
                <input type="text" id="emailCategoryName-${index}" class="input input-bordered w-full" value="${name}" />
              </td>
              <td>
                <input type="text" id="emailCategoryDescription-${index}" class="input input-bordered w-full" value="${description}" />
              </td>
            </tr>
          `).join('');
      
          $('#emailCategoryTable tbody').html(categoryRows);
      
          $('#addEmailCategory').on('click', () => {
            const newRow = `
              <tr>
                <td>
                  <input type="text" id="emailCategoryName-${$('#emailCategoryTable tbody tr').length}" class="input input-bordered w-full" placeholder="Category Name" />
                </td>
                <td>
                  <input type="text" id="emailCategoryDescription-${$('#emailCategoryTable tbody tr').length}" class="input input-bordered w-full" placeholder="Category Description" />
                </td>
              </tr>
            `;
            $('#emailCategoryTable tbody').append(newRow);
          });
      
          $('#saveBackgroundInfo').on('click', () => {
            const emailCategories = {};
            $('#emailCategoryTable tbody tr').each((index, row) => {
              const name = $(`#emailCategoryName-${index}`, row).val();
              const description = $(`#emailCategoryDescription-${index}`, row).val();
              if (name.trim() !== '') {
                emailCategories[name] = description;
              }
            });
            this.emailProcessor.userSettings.saveSettings({ emailCategories });
          });
        } catch (error) {
          console.error('Failed to load background info:', error);
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
                                    <button class="btn btn-sm gap-2 tooltip tooltip-left" data-tip="Show Important Only"
                                        id="toggleRepliedEmails">
                                        <i class="bi bi-star"></i>
                                    </button>
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

        
        const themeSelect = document.getElementById('themeSelect');
        
        themeSelect.value = localStorage.getItem('theme') || 'dark';

        themeSelect.addEventListener('change', (e) => {
            const theme = e.target.value;
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);
        });
        document.addEventListener('DOMContentLoaded', function () {
            window.app.init();
        });
    </script>
</body>

</html>

//--- File: /home/luan_ngo/web/events/public/calendar.js ---
class Calendar {
    constructor(containerId) {
        this.containerId = containerId;
        this.currentDate = new Date();
        this.events = [];
        this.weatherData = new Map();
        this.isMobile = window.innerWidth < 768;
        this.viewType = this.isMobile ? 'agenda' : 'month';

        
        window.addEventListener('resize', () => {
            const wasMobile = this.isMobile;
            this.isMobile = window.innerWidth < 768;
            if (wasMobile !== this.isMobile) {
                this.viewType = this.isMobile ? 'agenda' : 'month';
                this.refreshCalendar();
            }
        });

        $(document).ready(() => this.initialize());
    }

    showModal(eventDetails) {
        
        eventDetails.labelEndTime = eventDetails.labelEndTime || eventDetails.endTime;

        const modalHTML = `
            <dialog id="eventModal" class="modal">
                <div class="modal-box">
                    <h3 class="font-bold text-lg">${eventDetails.title}</h3>
                    <div class="py-4 space-y-2">
                        ${eventDetails.room ? `
                            <p class="flex items-center gap-2">
                                <i class="bi bi-geo-alt"></i>
                                <span>${eventDetails.room}</span>
                            </p>
                        ` : ''}
                        <p class="flex items-center gap-2">
                            <i class="bi bi-clock"></i>
                            <span>${moment(eventDetails.startTime).format('h:mm A')} - ${moment(eventDetails.labelEndTime).format('h:mm A')}</span>
                        </p>
                        ${eventDetails.description ? `
                            <p class="flex items-center gap-2">
                                <i class="bi bi-card-text"></i>
                                <span>${eventDetails.description}</span>
                            </p>
                        ` : ''}
                    </div>
                    <div class="modal-action">
                        <form method="dialog">
                            <button class="btn">Close</button>
                        </form>
                    </div>
                </div>
            </dialog>
        `;

        
        $('#eventModal').remove();

        
        $('body').append(modalHTML);
        document.getElementById('eventModal').showModal();
    }

    eventClickHandler(eventId) {
        const eventDetails = this.events.find(event => event.id === eventId);
        if (eventDetails) {
            this.showModal(eventDetails);
        }
    }

    constructHTML() {
        const html = `
            <div class="calendar-container">
                <div class="calendar-header">
                    <div class="flex justify-between items-center mb-4">
                        <h4 class="calendar-month-year">
                            <span id="month" class="calendar-month"></span>
                            <span id="year" class="calendar-year"></span>
                        </h4>
                        <div class="flex items-center gap-2">
                            ${!this.isMobile ? `
                                <div class="btn-group">
                                    <button class="btn btn-sm" id="viewMonth">Month</button>
                                    <button class="btn btn-sm" id="viewAgenda">Agenda</button>
                                </div>
                            ` : ''}
                            <div class="btn-group">
                                <button id="left" class="btn btn-sm">
                                    <i class="bi bi-chevron-left"></i>
                                </button>
                                <button id="today" class="btn btn-sm">Today</button>
                                <button id="right" class="btn btn-sm">
                                    <i class="bi bi-chevron-right"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="calendar-body"></div>
            </div>
        `;
        $(`#${this.containerId}`).html(html);

        this.bindViewControls();
    }

    bindViewControls() {
        $('#viewMonth', `#${this.containerId}`).on('click', () => {
            this.viewType = 'month';
            this.refreshCalendar();
            $('#viewMonth').addClass('btn-active');
            $('#viewAgenda').removeClass('btn-active');
        });

        $('#viewAgenda', `#${this.containerId}`).on('click', () => {
            this.viewType = 'agenda';
            this.refreshCalendar();
            $('#viewAgenda').addClass('btn-active');
            $('#viewMonth').removeClass('btn-active');
        });

        $('#today', `#${this.containerId}`).on('click', () => {
            this.currentDate = new Date();
            this.refreshCalendar();
        });
    }

    generateMonthView(d) {
        const firstDayOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
        const totalDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        let html = '<table class="table calendar"><thead><tr>';

        
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
            html += `<th>${day}</th>`;
        });
        html += '</tr></thead><tbody><tr>';

        
        for (let i = 0; i < firstDayOfMonth; i++) {
            html += '<td class="bg-base-200/50"></td>';
        }

        
        for (let day = 1; day <= totalDays; day++) {
            const dayDate = moment(new Date(d.getFullYear(), d.getMonth(), day));
            const dateStr = dayDate.format('YYYY-MM-DD');
            const isToday = dayDate.isSame(moment(), 'day');
            const weather = this.weatherData.get(dateStr);

            if ((day + firstDayOfMonth - 1) % 7 === 0 && day > 1) {
                html += '</tr><tr>';
            }

            
            const dayEvents = this.events.filter(event => {
                const eventDate = moment(event.startTime);
                return eventDate.format('YYYY-MM-DD') === dateStr;
            });

            html += `
                <td class="relative ${isToday ? 'bg-primary/5' : ''}" data-date="${dateStr}">
                    <div class="flex justify-between items-start">
                        <span class="font-bold ${isToday ? 'text-primary' : ''}">${day}</span>
                        ${weather ? `
                            <div class="weather-info text-xs flex flex-col items-end">
                                <i class="bi ${this.getWMOIcon(weather.weatherCode).icon} ${this.getWMOIcon(weather.weatherCode).class}"></i>
                                <div class="text-right">
                                    <span class="text-red-500">${weather.maxTemp}°</span>
                                    <span class="text-blue-500">${weather.minTemp}°</span>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div class="space-y-1 mt-1">
                        ${dayEvents.map(event => `
                            <div class="event-bar bg-primary/10 hover:bg-primary/20 cursor-pointer p-1 rounded text-xs" 
                                 data-eventid="${event.id}" 
                                 title="${event.title}">
                                ${moment(event.startTime).format('HH:mm')} ${event.title}
                            </div>
                        `).join('')}
                    </div>
                </td>
            `;
        }

        
        const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth(), totalDays).getDay();
        for (let i = lastDayOfMonth; i < 6; i++) {
            html += '<td class="bg-base-200/50"></td>';
        }

        html += '</tr></tbody></table>';
        return html;
    }

    generateAgendaView() {
        const startOfMonth = moment(this.currentDate).startOf('month');
        const endOfMonth = moment(this.currentDate).endOf('month');

        
        const monthEvents = this.events
            .filter(event => {
                const eventDate = moment(event.startTime);
                return eventDate.isBetween(startOfMonth, endOfMonth, 'day', '[]');
            })
            .sort((a, b) => moment(a.startTime).valueOf() - moment(b.startTime).valueOf());

        if (monthEvents.length === 0) {
            return `
                <div class="text-center p-8 text-base-content/70">
                    <i class="bi bi-calendar-x text-4xl mb-2"></i>
                    <p>No events scheduled this month</p>
                </div>
            `;
        }

        
        const groupedEvents = monthEvents.reduce((groups, event) => {
            const dateKey = moment(event.startTime).format('YYYY-MM-DD');
            if (!groups[dateKey]) {
                groups[dateKey] = [];
            }
            groups[dateKey].push(event);
            return groups;
        }, {});

        
        let html = '<div class="space-y-4">';

        Object.entries(groupedEvents).forEach(([date, dateEvents]) => {
            const momentDate = moment(date);
            const isToday = momentDate.isSame(moment(), 'day');
            const weather = this.weatherData.get(date);

            html += `
                <div class="agenda-day ${isToday ? 'border-l-4 border-primary pl-2' : ''}">
                    <div class="flex justify-between items-center mb-2">
                        <h3 class="font-bold text-lg">
                            ${momentDate.format('ddd, MMM D')}
                            ${isToday ? ' <span class="badge badge-primary">Today</span>' : ''}
                        </h3>
                        ${weather ? `
                            <div class="flex items-center gap-2 text-sm">
                                <i class="bi ${this.getWMOIcon(weather.weatherCode).icon} ${this.getWMOIcon(weather.weatherCode).class}"></i>
                                <span class="text-red-500">${weather.maxTemp}°</span>
                                <span class="text-blue-500">${weather.minTemp}°</span>
                            </div>
                        ` : ''}
                    </div>
                    <div class="space-y-2">
                        ${dateEvents.map(event => `
                            <div class="card bg-base-100 p-3 cursor-pointer hover:shadow-md transition-shadow" 
                                 data-eventid="${event.id}"
                                 onclick="window.app.mainCalendar.eventClickHandler(${event.id})">
                                <div class="flex justify-between items-start">
                                    <div>
                                        <p class="font-medium">${event.title}</p>
                                        <p class="text-sm text-base-content/70">
                                            ${moment(event.startTime).format('h:mm A')} - 
                                            ${moment(event.endTime).format('h:mm A')}
                                        </p>
                                        ${event.room ? `
                                            <p class="text-sm text-base-content/70">
                                                <i class="bi bi-geo-alt"></i> ${event.room}
                                            </p>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        html += '</div>';
        return html;
    }

    loadEvents(events) {
        this.events = events;
        this.refreshCalendar();
    }

    refreshCalendar() {
        if (this.viewType === 'agenda' || this.isMobile) {
            $('.calendar-body', `#${this.containerId}`).html(this.generateAgendaView());
        } else {
            $('.calendar-body', `#${this.containerId}`).html(this.generateMonthView(this.currentDate));

            
            $('.event-bar').on('click', (e) => {
                const eventId = $(e.currentTarget).data('eventid');
                this.eventClickHandler(eventId);
            });
        }

        this.updateMonthYear(this.currentDate);

        
        if (!this.isMobile) {
            $(`#viewMonth`).toggleClass('btn-active', this.viewType === 'month');
            $(`#viewAgenda`).toggleClass('btn-active', this.viewType === 'agenda');
        }
    }

    updateMonthYear(d) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];

        $('#month', `#${this.containerId}`).text(monthNames[d.getMonth()]);
        $('#year', `#${this.containerId}`).text(d.getFullYear());
    }

    getWMOIcon(code) {
        const weatherCodes = {
            0: { icon: 'bi-sun-fill', class: 'text-yellow-500' },
            1: { icon: 'bi-sun-fill', class: 'text-yellow-500' },
            2: { icon: 'bi-cloud-sun-fill', class: 'text-gray-500' },
            3: { icon: 'bi-cloud-fill', class: 'text-gray-500' },
            45: { icon: 'bi-cloud-haze-fill', class: 'text-gray-400' },
            48: { icon: 'bi-cloud-haze-fill', class: 'text-gray-400' },
            51: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },
            53: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },
            55: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },
            61: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },
            63: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },
            65: { icon: 'bi-cloud-rain-heavy-fill', class: 'text-blue-600' },
            71: { icon: 'bi-snow', class: 'text-blue-200' },
            73: { icon: 'bi-snow', class: 'text-blue-200' },
            75: { icon: 'bi-snow-fill', class: 'text-blue-200' },
            95: { icon: 'bi-cloud-lightning-fill', class: 'text-yellow-600' },
            96: { icon: 'bi-cloud-lightning-rain-fill', class: 'text-yellow-600' },
            99: { icon: 'bi-cloud-lightning-rain-fill', class: 'text-yellow-600' }
        };

        return weatherCodes[code] || { icon: 'bi-question-circle', class: 'text-gray-500' };
    }

    async fetchWeatherData() {
        try {
            const response = await fetch('https:
                latitude: '43.65',  
                longitude: '-79.38',
                daily: ['weather_code', 'temperature_2m_max', 'temperature_2m_min'],
                timezone: 'America/New_York'
            }));

            const data = await response.json();

            
            data.daily.time.forEach((date, index) => {
                this.weatherData.set(date, {
                    weatherCode: data.daily.weather_code[index],
                    maxTemp: Math.round(data.daily.temperature_2m_max[index]),
                    minTemp: Math.round(data.daily.temperature_2m_min[index])
                });
            });
        } catch (error) {
            console.error('Error fetching weather data:', error);
        }
    }

    async changeMonth(offset) {
        this.currentDate.setMonth(this.currentDate.getMonth() + offset);
        await this.fetchWeatherData();
        this.refreshCalendar();
    }

    bindEventHandlers() {
        
        $('#left', `#${this.containerId}`).off('click').on('click', () => this.changeMonth(-1));
        $('#right', `#${this.containerId}`).off('click').on('click', () => this.changeMonth(1));

        
        if (!this.isMobile) {
            $('#viewMonth, #viewAgenda', `#${this.containerId}`).off('click').on('click', (e) => {
                const viewType = e.currentTarget.id.replace('view', '').toLowerCase();
                this.viewType = viewType;
                this.refreshCalendar();
            });
        }

        
        $('#today', `#${this.containerId}`).off('click').on('click', () => {
            this.currentDate = new Date();
            this.refreshCalendar();
        });

        
        $('.event-bar, .agenda-event').off('click').on('click', (e) => {
            const eventId = $(e.currentTarget).data('eventid');
            this.eventClickHandler(eventId);
        });
    }

    async initialize() {
        await this.fetchWeatherData();
        this.constructHTML();
        this.bindEventHandlers();
        this.refreshCalendar();

        
        this.bindEventHandlers();

        
        $(window).on('resize', _.debounce(() => {
            const newIsMobile = window.innerWidth < 768;
            if (this.isMobile !== newIsMobile) {
                this.isMobile = newIsMobile;
                this.viewType = this.isMobile ? 'agenda' : 'month';
                this.refreshCalendar();
            }
        }, 250));
    }
}

//--- File: /home/luan_ngo/web/events/public/ReceiptManager.js ---
class ReceiptManager {
  constructor(rentalFee) {
    this.items = [];
    this.tipPercent = 0;
    this.ccSurcharge = false;
    this.taxRate = 0.13;
    this.rentalFee = rentalFee || 0;

    this.createDialog();
    this.initializeEventListeners();

    
    this.dialog.showModal();
  }
  createDialog() {
    const dialogHtml = `
        <dialog id="receiptDialog" class="modal">
            <div class="modal-box max-w-2xl">
                <div id="receiptContent">
                    
                    <div class="text-center space-y-2 mt-6">
                        <p class="text-sm">I say taco, you say taco!</p>
                        <h1 class="font-bold text-2xl">TacoTaco</h1>
                        <p class="text-sm">319 Augusta Ave. Toronto ON M5T2M2</p>
                    </div>

                    
                    <div class="space-y-4 mt-6">
                        <table class="table w-full" id="receiptItems">
                            <thead>
                                <tr>
                                    <th class="text-left">Item</th>
                                    <th class="text-right w-20">Qty</th>
                                    <th class="text-right w-24">Price</th>
                                    <th class="text-right w-24">Total</th>
                                    <th class="w-12"></th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>

                    
                    <div class="space-y-2 border-t pt-4 mt-8">
                        <div class="flex justify-between">
                            <span>Subtotal</span>
                            <span id="subtotalAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between">
                            <span>Tip (<span id="tipPercentDisplay">0</span>%)</span>
                            <span id="tipAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between items-center">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <span>CC Surcharge <span id="ccLabel"></span></span>
                                <input type="checkbox" id="ccSurcharge" class="checkbox checkbox-sm print:hidden">
                            </label>
                            <span id="surchargeAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between">
                            <span>Tax (13%)</span>
                            <span id="taxAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between font-bold text-lg border-t pt-2">
                            <span>Total</span>
                            <span id="totalAmount">$0.00</span>
                        </div>
                    </div>

                    
                    <div class="text-center text-sm space-y-1 mt-8">
                        <div>eattaco.ca@tacotacoto</div>
                        <div>GST/HST #: 773762067RT0001</div>
                    </div>
                </div> 

                
                <div class="border-t mt-8 pt-4 print:hidden">
                    <h3 class="font-semibold text-lg mb-4">Receipt Controls</h3>

                    
                    <div class="mb-4">
                        <div class="flex items-center gap-2">
                            <span class="w-24">Tip Amount:</span>
                            <select id="tipPercent" class="select select-bordered select-sm">
                                <option value="0">0%</option>
                                <option value="10">10%</option>
                                <option value="15">15%</option>
                                <option value="18">18%</option>
                                <option value="20">20%</option>
                            </select>
                        </div>
                    </div>

                    
                    <div class="overflow-x-auto">
                        <table class="table w-full">
                            <thead>
                                <tr>
                                    <th class="text-left">Item</th>
                                    <th class="text-left">Quantity</th>
                                    <th class="text-left">Price</th>
                                    <th></th> 
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>
                                        <input type="text" id="newItemName" placeholder="Item name" value="Rental"
                                               class="input input-bordered input-sm w-full">
                                    </td>
                                    <td>
                                        <input type="number" id="newItemQty" placeholder="Qty" value="1" min="1"
                                               class="input input-bordered input-sm w-full">
                                    </td>
                                    <td>
                                        <input type="number" id="newItemPrice" placeholder="Price" step="0.01"
                                               value="${((this.rentalFee/2)/1.13).toFixed(2)}"
                                               class="input input-bordered input-sm w-full">
                                    </td>
                                    <td class="text-center">
                                        <button id="addItemBtn" class="btn btn-sm btn-ghost btn-square text-success">
                                            <span class="font-bold text-lg">+</span>
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                
                <div class="modal-action mt-6 print:hidden">
                    <button id="downloadReceiptBtn" class="btn btn-success gap-2">
                        Save as Image
                    </button>
                    <button id="printReceiptBtn" class="btn btn-primary">
                        Print
                    </button>
                    <form method="dialog">
                        <button class="btn">Close</button>
                    </form>
                </div>
            </div>
            <form method="dialog" class="modal-backdrop">
                <button>close</button>
            </form>
        </dialog>
    `;

    document.body.insertAdjacentHTML('beforeend', dialogHtml);
    this.dialog = document.getElementById('receiptDialog');
}


  
  initializeEventListeners() {
    
    document.getElementById('addItemBtn').addEventListener('click', () => {
      this.handleAddItem();
    });

    
    document.getElementById('newItemPrice').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleAddItem();
      }
    });

    document.getElementById('tipPercent').addEventListener('change', (e) => {
      this.tipPercent = parseInt(e.target.value);
      document.getElementById('tipPercentDisplay').textContent = this.tipPercent;
      this.updateTotals();
    });
    
    document.getElementById('ccSurcharge').addEventListener('change', (e) => {
      this.ccSurcharge = e.target.checked;
      document.getElementById('ccLabel').textContent = this.ccSurcharge ? '(2.4%)' : '';
      this.updateTotals();
    });

    
    document.getElementById('printReceiptBtn').addEventListener('click', () => {
      window.print();
    });

    
    document.getElementById('downloadReceiptBtn').addEventListener('click', () => {
      this.downloadAsImage();
    });

    
    this.dialog.addEventListener('close', () => {
      this.dialog.remove();
      delete window.currentReceipt;
    });
  }

  handleAddItem() {
    const nameInput = document.getElementById('newItemName');
    const qtyInput = document.getElementById('newItemQty');
    const priceInput = document.getElementById('newItemPrice');

    const name = nameInput.value;
    const quantity = parseInt(qtyInput.value);
    const price = parseFloat(priceInput.value);

    if (name && quantity > 0 && price >= 0) {
      this.addItem({ name, quantity, price });
      nameInput.value = 'Rental';
      qtyInput.value = '1';
      priceInput.value = this.rentalFee.toFixed(2);
      priceInput.focus();
    }
  }

  addItem({ name, quantity, price }) {
    const item = { name, quantity, price, id: Date.now() };
    this.items.push(item);
    this.renderItems();
    this.updateTotals();
  }

  removeItem(itemId) {
    this.items = this.items.filter(item => item.id !== itemId);
    this.renderItems();
    this.updateTotals();
  }

  renderItems() {
    const tbody = document.querySelector('#receiptItems tbody');
    const itemsHtml = this.items.map(item => `
          <tr class="border-b">
              <td class="p-2">${item.name}</td>
              <td class="text-right p-2">${item.quantity}</td>
              <td class="text-right p-2">$${item.price.toFixed(2)}</td>
              <td class="text-right p-2">$${(item.quantity * item.price).toFixed(2)}</td>
              <td class="text-right p-2 print:hidden">
                  <button onclick="window.currentReceipt.removeItem(${item.id})" class="text-red-600 hover:text-red-700">
                      <i class="bi bi-x"></i>
                  </button>
              </td>
          </tr>
      `).join('');

    tbody.innerHTML = itemsHtml;
  }

  updateTotals() {
    const subtotal = this.items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    const tipableAmount = this.items
      .filter(item => item.name.toLowerCase() !== 'rental')
      .reduce((sum, item) => sum + (item.quantity * item.price), 0);

    const tip = (tipableAmount * this.tipPercent) / 100;
    const tax = subtotal * this.taxRate;
    const subtotalWithTipAndTax = subtotal + tip + tax;
    const surcharge = this.ccSurcharge ? subtotalWithTipAndTax * 0.024 : 0;
    const total = subtotalWithTipAndTax + surcharge;

    document.getElementById('subtotalAmount').textContent = `$${subtotal.toFixed(2)}`;
    document.getElementById('tipAmount').textContent = `$${tip.toFixed(2)}`;
    document.getElementById('taxAmount').textContent = `$${tax.toFixed(2)}`;
    document.getElementById('surchargeAmount').textContent = `$${surcharge.toFixed(2)}`;
    document.getElementById('totalAmount').textContent = `$${total.toFixed(2)}`;
  }
  async downloadAsImage() {
    try {
      const element = document.getElementById('receiptContent');
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
      });
  
      const image = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `Receipt-${new Date().toISOString().split('T')[0]}.png`;
      link.href = image;
      link.click();
    } catch (error) {
      console.error('Error generating image:', error);
      alert('Could not generate receipt image. Please try printing instead.');
    }
  }
  

}

//--- File: /home/luan_ngo/web/events/public/EmailProcessor.js ---
class EmailProcessor {
    constructor(parent) {
        this.currentConversationId = null;
        this.registerEvents();
        this.parent = parent;

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

//--- File: /home/luan_ngo/web/events/public/EmailEventUpdater.js ---
class EmailEventUpdater {
    constructor(app) {
        this.app = app;
        this.highlightedFields = new Set();
    }

    async updateEventFromEmail(emailContent, emailAddress) {
        try {
            
            const event = this.app.contacts.find(contact => 
                contact.email && contact.email.toLowerCase() === emailAddress.toLowerCase()
            );

            if (!event) {
                this.app.showToast('No matching event found for this email', 'error');
                return;
            }

            
            this.app.loadContact(event.id);

            
            const response = await fetch('/ai/analyzeEventUpdate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventDetails: event,
                    emailContent: emailContent
                })
            });

            if (!response.ok) {
                throw new Error('Failed to analyze event update');
            }

            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to analyze event update');
            }

            
            const timestamp = moment().format('MM/DD/YYYY HH:mm');
            const updatedNotes = `[${timestamp}] Update from email:\n${result.summary}\n\n${event.notes || ''}`;
            
            
            event.notes = updatedNotes;
            
            
            const updatedFields = new Set(['notes']);
            this.updateUI(event, updatedFields);

            
            

            
            

            return true;
        } catch (error) {
            console.error('Error updating event from email:', error);
            this.app.showToast('Failed to update event information', 'error');
            return false;
        }
    }

    updateUI(event, updatedFields) {
        
        this.clearHighlights();
        this.highlightedFields = updatedFields;

        
        updatedFields.forEach(field => {
            const element = document.getElementById(`info${field.charAt(0).toUpperCase() + field.slice(1)}`);
            if (element) {
                
                if (field === 'notes') {
                    element.value = event.notes;
                } else {
                    element.value = event[field];
                }

                
                const label = element.previousElementSibling;
                if (label && label.classList.contains('label')) {
                    label.style.backgroundColor = '#fff3cd';
                }
            }
        });

        
        const saveButton = document.getElementById('infoSave');
        if (saveButton) {
            const originalClick = saveButton.onclick;
            saveButton.onclick = (e) => {
                if (originalClick) originalClick(e);
                this.clearHighlights();
            };
        }
    }

    clearHighlights() {
        this.highlightedFields.forEach(field => {
            const element = document.getElementById(`info${field.charAt(0).toUpperCase() + field.slice(1)}`);
            if (element) {
                const label = element.previousElementSibling;
                if (label && label.classList.contains('label')) {
                    label.style.backgroundColor = '';
                }
            }
        });
        this.highlightedFields.clear();
    }
}

//--- File: /home/luan_ngo/web/events/src/styles.css ---
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {

  html,
  body {
    @apply overflow-x-hidden;
  }

  body {
    @apply pb-16 lg:pb-0;
    @apply bg-base-100;
  }
}

@layer components {

  
  .card {
    @apply bg-base-200 text-base-content border border-base-300;
  }

  
  .form-control {
    @apply relative space-y-1;
  }

  .form-control .label {
    @apply pb-1;
  }

  .form-control .label-text {
    @apply opacity-70 font-medium;
  }

  .input,
  .select,
  .textarea {
    @apply bg-base-100 border-base-300 transition-all duration-200;
    @apply focus:ring-2 focus:ring-primary/20 focus:border-primary;
    @apply disabled:bg-base-200 disabled:cursor-not-allowed;
  }

  
  .messages-container {
    @apply flex-1 overflow-y-auto overflow-x-hidden space-y-4 p-4;
    height: calc(100vh - 16rem);
    
    -webkit-overflow-scrolling: touch;
  }

  
  .top-nav {
    @apply hidden lg:flex fixed top-4 right-4 gap-2 z-50;
  }

  .btm-nav {
    @apply fixed bottom-0 left-0 right-0 z-[9999] bg-base-100 border-t border-base-200;
    @apply flex flex-row justify-around items-center;
    @apply lg:hidden;
    
    height: 4rem;
    position: fixed !important;
    
  }

  .btm-nav button {
    @apply flex-1 flex flex-col items-center justify-center gap-1;
    @apply transition-colors duration-200;
    @apply text-base-content/70 hover:text-base-content;
    min-height: 4rem;
  }

  .btm-nav button.active {
    @apply text-primary bg-base-200 border-t-2 border-primary;
  }

  
  body {
    @apply pb-16 lg:pb-0;
    
  }

  main {
    @apply mb-16 lg:mb-0;
    
  }

  
  #messages,
  #actions {
    @apply flex flex-col;
    min-height: calc(100vh - 16rem);
  }

  @screen lg {
    .messages-container {
      height: calc(75vh - 8rem);
      
    }
  }


.calendar-container {
  @apply w-full;
}

.calendar-header {
  @apply sticky top-0 bg-base-100 z-10 px-4 py-2 border-b border-base-300;
}

.calendar-body {
  @apply p-4;
}


.calendar {
  @apply w-full border-collapse;
}

.calendar th {
  @apply p-2 text-center font-medium text-base-content/70;
}

.calendar td {
  @apply p-2 border border-base-300 h-24 align-top;
}


.agenda-day {
  @apply bg-base-200 rounded-lg p-4;
}

.event-card {
  @apply bg-base-100 rounded-lg p-3 hover:shadow-md transition-shadow;
}


@media (max-width: 768px) {
  .calendar-container {
      @apply h-[calc(100vh-16rem)];
      @apply flex flex-col;
  }
  
  .calendar-body {
      @apply flex-1 overflow-y-auto;
  }
}
  
  .sms {
    @apply bg-base-100 border border-base-300 rounded-lg p-4;
  }

  .email {
    @apply transition-all duration-200 overflow-hidden;
    max-height: 25vh;
  }

  .email.expanded {
    max-height: none;
  }

  .email-header {
    @apply mb-3 text-sm text-base-content/70 space-y-1;
  }

  .email-body {
    @apply text-base-content whitespace-pre-line mt-4;
  }

  
  .icon-btn {
    @apply inline-flex items-center justify-center w-8 h-8 rounded-full;
    @apply hover:bg-base-200 transition-colors text-base-content/70 hover:text-base-content;
  }

  
  .aiChatReponse {
    @apply bg-base-200 border border-base-300 rounded-lg p-4;
  }

  
  .contactCont {
    @apply p-2 hover:bg-base-300/50 rounded-lg transition-colors;
  }

  
  .event-bar {
    @apply text-xs p-1 mt-1 rounded cursor-pointer truncate;
  }

  .event-room-1 {
    @apply bg-primary/30 hover:bg-primary/40;
  }

  .event-room-2 {
    @apply bg-secondary/30 hover:bg-secondary/40;
  }

  
  @screen md {
    main {
      @apply pb-0;
    }
  }

  
  .modal {
    @apply p-4;
  }

  .modal-box {
    @apply max-h-[90vh] overflow-y-auto;
  }
}


@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideIn {
  from {
    transform: translateX(-10px);
    opacity: 0;
  }

  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.fade-in {
  animation: fadeIn 0.3s ease-in-out;
}

.slide-in {
  animation: slideIn 0.3s ease-in-out;
}

//--- File: /home/luan_ngo/web/events/tailwind.config.js ---

module.exports = {
  content: [
    "./src*.{html,js}",
    "./public*.{html,js}",
    "./index.html"
  ],
  theme: {
    extend: {
      
      height: {
        'screen-minus-nav': 'calc(100vh - 4rem)',
        'screen-minus-header': 'calc(100vh - 8rem)',
      },
      
      minHeight: {
        'screen-minus-nav': 'calc(100vh - 4rem)',
        'screen-minus-header': 'calc(100vh - 8rem)',
      },
      
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
      },
      
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-in-out',
        'press': 'press 0.2s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        press: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(0.95)' },
        },
      },
      
      screens: {
        'xs': '475px',
        
        'calendar': '900px',
      },
    },
  },
  plugins: [
    require("daisyui"),
    
    function({ addUtilities }) {
      const newUtilities = {
        '.safe-padding-bottom': {
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        },
        '.safe-margin-bottom': {
          marginBottom: 'env(safe-area-inset-bottom, 16px)',
        },
        '.mobile-height': {
          height: '-webkit-fill-available',
        },
      };
      addUtilities(newUtilities);
    },
  ],
  daisyui: {
    themes: ["light", "dark", "cupcake"],
    
    styled: true,
    base: true,
    utils: true,
    logs: true,
    rtl: false,
  },
}

//--- File: /home/luan_ngo/web/events/combine.js ---
const { checkbox } = require('@inquirer/prompts');
const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');


const outputFile = './combinedFile.js';  


const selectionFile = './previousSelection.json';


const filesToCombine = [
    '!./public/tailwind.config.js',  
    "./services)
    let result = content.replace(/\/\/.*$|\/\*[\s\S]*?\*\

    
    result = result.replace(//g, '');

    return result;
};


const saveSelection = (selectedFiles) => {
    try {
        fs.writeFileSync(selectionFile, JSON.stringify(selectedFiles, null, 2), 'utf8');
    } catch (err) {
        console.error('Error saving selection:', err);
    }
};


const loadPreviousSelection = () => {
    if (fs.existsSync(selectionFile)) {
        try {
            const data = fs.readFileSync(selectionFile, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.error('Error loading previous selection:', err);
        }
    }
    return [];
};


const combineFiles = (selectedFiles) => {
    const writeStream = fs.createWriteStream(outputFile);

    selectedFiles.forEach((file) => {
        if (fs.existsSync(file)) {
            let fileContent = fs.readFileSync(file, 'utf8');

            
            fileContent = removeComments(fileContent);

            writeStream.write(`\n
            writeStream.write(fileContent);
            writeStream.write('\n');  
        } else {
            console.log(`File not found: ${file}`);
        }
    });

    writeStream.end();
    console.log(`\nAll selected files have been combined into: ${outputFile}`);
};


const main = async () => {
    let allFiles = getFilesFromPatterns(filesToCombine);

    
    allFiles = allFiles.filter(file => !excludeFiles.includes(path.resolve(file)));

    if (allFiles.length === 0) {
        console.log("No matching files found.");
        process.exit(1);
    }

    
    const previousSelection = loadPreviousSelection();

    
    const choices = allFiles.map(file => ({
        name: file,
        value: file,
        checked: previousSelection.includes(file)  
    }));

    
    const selectedFiles = await checkbox({
        message: 'Select files to combine:',
        choices
    });

    if (selectedFiles.length === 0) {
        console.log("No files selected. Exiting.");
        process.exit(0);
    }

    
    saveSelection(selectedFiles);

    
    combineFiles(selectedFiles);
};


main();


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
const cron = require('node-cron');


const googleAuth = new GoogleAuth();


const app = express();

const gmailService = new GmailService(googleAuth);
const eventService = new EventService(googleAuth);


gmailService.setEventService(eventService);
eventService.setGmailService(gmailService);

const emailProcessor = new EmailProcessorServer(googleAuth, gmailService,eventService);




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

