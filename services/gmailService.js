const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const cheerio = require('cheerio');
const { z } = require('zod');
const User = require('./User');
class GmailService {
    constructor(auth, eventService = null) {
        this.auth = auth;
        this.cacheFilePath = path.join(__dirname, '..', 'data', 'emails.json');
        this.lastRetrievalPath = path.join(__dirname, '..', 'data', 'lastRetrieval.json');

        // Initialize user instance
        this.user = new User();
        this.user.loadSettings().catch(err => {
            console.error('Error loading user settings:', err);
        });

        // Initialize all caches
        // In constructor
        this.emailCache = new Map();
        this.messageCache = new Map(); // Add this line
        this.eventsCache = [];
        this.emailToEventMap = new Map();
        this.threadCache = new Map(); // Add this line

        // Initialize timestamps
        this.lastEventsCacheUpdate = 0;
        this.lastRetrievalDate = this.loadLastRetrievalDate();

        // Initialize services
        this.aiService = require('./aiService');
        this.eventService = eventService;

        // Ensure data directory exists
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Load cached emails into memory
        this.loadEmailsFromCache();
    }

    setEventService(eventService) {
        this.eventService = eventService;
        this.refreshEventsCache();
    }
    async refreshEventsCache() {
        if (this.eventService) {
            this.eventsCache = this.eventService.loadEvents();

            // Rebuild the email-to-event map
            this.emailToEventMap.clear();
            this.eventsCache
                .filter(event => event.email && event.email.trim() !== '')
                .forEach(event => {
                    this.emailToEventMap.set(event.email.toLowerCase().trim(), event);
                });

            this.lastEventsCacheUpdate = Date.now();
        }
    }


    // Helper to check if events cache needs refresh (e.g., if it's older than 5 minutes)
    shouldRefreshEventsCache() {
        const CACHE_LIFETIME = 5 * 60 * 1000; // 5 minutes in milliseconds
        return Date.now() - this.lastEventsCacheUpdate > CACHE_LIFETIME;
    }
    // In GmailService class
    async formatReplyContent(content, originalMessage) {
        // Get original message details
        const headers = originalMessage.payload.headers;
        const originalDate = headers.find(h => h.name === 'Date')?.value;
        const originalFrom = headers.find(h => h.name === 'From')?.value;
        const originalContent = originalMessage.parsedContent.html ||
            originalMessage.parsedContent.text ||
            headers.find(h => h.name === 'snippet')?.value;

        // Format quoted content
        const quotedContent = `
        <div style="margin-top: 20px;">
            <div style="padding: 10px 0;">On ${originalDate}, ${originalFrom} wrote:</div>
            <blockquote style="margin:0 0 0 0.8ex; border-left:2px #ccc solid; padding-left:1ex;">
                ${originalContent}
            </blockquote>
        </div>
    `;

        // If the new content already includes html tags, insert before closing body
        if (content.includes('</body>')) {
            return content.replace('</body>', `${quotedContent}</body>`);
        }

        // Otherwise just append
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

            // Determine if this is a reply based on options
            const isReply = options.replyToMessageId ||
                options.source === 'draftEventSpecificEmail' ||
                options.source === 'generateConfirmationEmail' ||
                options.source === 'sendToAiTextArea';

            let threadId = null;
            let originalMessageId = null;
            let originalContent = '';

            // Get thread and message IDs for replies
            if (isReply && options.replyToMessageId) {
                const originalMessage = await this.getMessage(options.replyToMessageId);
                threadId = originalMessage.threadId;
                const headers = originalMessage.payload.headers;
                originalMessageId = headers.find(h => h.name === 'Message-ID')?.value;

                // Format the original message content as quoted
                originalContent = await this.formatReplyContent(content, originalMessage);
            } else {
                // If not replying, use the content directly
                originalContent = this.formatEmailContent(content);
            }

            // Prepare email headers
            const headers = [
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=UTF-8',
                `From: ${options.from || 'me'}`,
                `To: ${to}`,
                `Subject: =?UTF-8?B?${Buffer.from(isReply ? (subject.startsWith('Re:') ? subject : `Re: ${subject}`) : subject).toString('base64')}?=`
            ];

            // Add reply headers if needed
            if (originalMessageId) {
                headers.push(`In-Reply-To: ${originalMessageId}`);
                headers.push(`References: ${originalMessageId}`);
            }

            // Combine headers and content
            const emailContent = `${headers.join('\r\n')}\r\n\r\n${originalContent}`;

            // Encode the email for sending
            const encodedMessage = Buffer.from(emailContent)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            // Send the email
            const res = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedMessage,
                    ...(threadId && { threadId })
                }
            });

            // Update cache for replies
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
        // Clean up any existing HTML structure
        let cleanContent = content
            .replace(/<html>.*?<body>/gs, '')
            .replace(/<\/body>.*?<\/html>/gs, '')
            .trim();

        // Ensure proper line breaks
        cleanContent = cleanContent
            .replace(/<br\s*\/?>/gi, '<br>')
            .replace(/\n/g, '<br>')
            .replace(/<br\s*\/?>(\s*<br\s*\/?>)+/gi, '<br><br>');

        // Wrap in a proper HTML structure with styling
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
        // Default to 30 minutes ago if no date found
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
            // Sort before saving
            const sortedEmails = emails.sort((a, b) => {
                return new Date(b.internalDate) - new Date(a.internalDate);
            });
            fs.writeFileSync(this.cacheFilePath, JSON.stringify(sortedEmails, null, 2), 'utf8');

            // Update in-memory cache
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
                // Update in-memory cache
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

            // Get sent messages first
            const sentResponse = await gmail.users.messages.list({
                userId: 'me',
                maxResults: options.maxResults || 100,
                q: options.email ? `from:me to:${options.email}` : 'in:sent',
                orderBy: 'internalDate desc'
            });

            const sentMessages = sentResponse.data.messages || [];

            // Get full details of sent messages first
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
            // Now get inbox messages
            const inboxResponse = await gmail.users.messages.list({
                userId: 'me',
                maxResults: options.maxResults || 100,
                q: query,
                orderBy: 'internalDate desc'
            });

            const inboxMessages = inboxResponse.data.messages || [];

            // Process inbox messages with the already-loaded sent messages
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

            // Check if thread messages are already cached
            let threadMessages = this.threadCache.get(threadId);
            if (!threadMessages) {
                threadMessages = await this.getThreadMessages(threadId);
                this.threadCache.set(threadId, threadMessages);
            }

            // Check for replies in the thread
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
            // First check cache
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

            // If we have HTML but no text, extract text from HTML
            if (!text && html) {
                text = this.extractPlainTextFromHtml(html);
            }

            // Create the full message object
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
                Analyze this email and categorize it into one of these categories: ${JSON.stringify(categories)}
                
                Email Subject: ${emailData.subject}
                Email Content: ${emailData.text || emailData.snippet}
            `;

            const categorySchema = this.user.getCategorySchema();

            const { parsedData } = await this.aiService.generateResponse(
                [{ role: 'user', content: prompt }],
                {
                    schema: categorySchema,
                    schemaName: 'EmailCategory',
                    resetHistory: true,
                    provider:"openai",
                    model:"gpt-4o-mini"
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
                // Check if email is already in cache
                if (this.emailCache.has(message.id)) {
                    // Email is already processed and cached
                    processedEmails.push(this.emailCache.get(message.id));
                    return; // Skip processing
                }

                // Fetch the full message
                const fullMessage = await this.getMessage(message.id);

                // Process the message
                const emailData = await this.processEmail(fullMessage);

                // Save to cache
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
            // Processing when headers are present
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

            // Process email categorization and event association in parallel
            const [eventAssociation, category] = await Promise.all([
                this.checkEventAssociation(emailData),
                this.categorizeEmail(emailData)
            ]);

            // Merge results
            emailData.associatedEventId = eventAssociation.eventId;
            emailData.associatedEventName = eventAssociation.eventName;
            emailData.category = category;

        } else {
            // Handle cases where headers are missing
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

            // Process email categorization and event association in parallel
            const [eventAssociation, category] = await Promise.all([
                this.checkEventAssociation(emailData),
                this.categorizeEmail(emailData)
            ]);

            // Merge results
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

            // Extract and normalize email addresses
            const fromEmail = emailData.from.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0]?.toLowerCase();
            const toEmail = emailData.to.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0]?.toLowerCase();

            // Check map for matches (O(1) lookups)
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
            // Basic HTML to text conversion
            return html
                .replace(/<style[^>]*>.*<\/style>/gs, '') // Remove style tags and their content
                .replace(/<script[^>]*>.*<\/script>/gs, '') // Remove script tags and their content
                .replace(/<[^>]+>/g, ' ') // Remove HTML tags
                .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim(); // Trim leading/trailing whitespace
        } catch (error) {
            console.error('Error converting HTML to text:', error);
            return '';
        }
    }
    mergeEmails(cachedEmails, newEmails) {
        const emailMap = new Map();

        // First add cached emails to preserve their properties
        cachedEmails.forEach(email => {
            emailMap.set(email.id, {
                ...email,
                // Ensure these properties exist with defaults
                hasNotified: email.hasNotified || false,
                category: email.category || 'other',
                processedForSuggestions: email.processedForSuggestions || false
            });
        });

        // Merge in new emails, preserving existing properties from cache if they exist
        newEmails.forEach(email => {
            const existingEmail = emailMap.get(email.id);
            emailMap.set(email.id, {
                ...(existingEmail || {}),  // Keep existing properties if they exist
                ...email,  // Add new properties
                // Ensure critical properties are preserved/defaulted
                replied: email.replied || existingEmail?.replied || false,
                hasNotified: existingEmail?.hasNotified || false,
                category: email.category || existingEmail?.category || 'other',
                processedForSuggestions: existingEmail?.processedForSuggestions || false,
                // Preserve associated event data if it exists
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

            // Return formatted list of labels with their IDs
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

            // Modify message labels in Gmail
            await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    removeLabelIds: ['INBOX'],
                    addLabelIds: ["Label_6"]
                }
            });

            // Update cache in memory and file
            if (this.emailCache.has(messageId)) {
                const emailData = this.emailCache.get(messageId);

                // Update labels in the cached email data
                emailData.labels = emailData.labels || [];
                emailData.labels = emailData.labels.filter(label => label !== 'INBOX');
                if (!emailData.labels.includes('Label_6')) {
                    emailData.labels.push('Label_6');
                }

                // Update the in-memory cache
                this.emailCache.set(messageId, emailData);

                // Update the file cache
                try {
                    let cachedEmails = [];
                    if (fs.existsSync(this.cacheFilePath)) {
                        cachedEmails = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8'));
                    }

                    // Find and update the email in the cached array
                    const emailIndex = cachedEmails.findIndex(email => email.id === messageId);
                    if (emailIndex !== -1) {
                        cachedEmails[emailIndex] = emailData;
                    }

                    // Save back to file
                    fs.writeFileSync(this.cacheFilePath, JSON.stringify(cachedEmails, null, 2), 'utf8');
                } catch (cacheError) {
                    console.error('Error updating cache file:', cacheError);
                    // Continue even if cache update fails
                }
            }

            return true;
        } catch (error) {
            console.error('Error archiving email:', error);
            // Try simple archive if label operations fail
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

                // Also update cache for simple archive
                if (this.emailCache.has(messageId)) {
                    const emailData = this.emailCache.get(messageId);
                    emailData.labels = emailData.labels.filter(label => label !== 'INBOX');
                    this.emailCache.set(messageId, emailData);

                    // Update file cache
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
    // Helper method to update a single email in cache
    async updateEmailInCache(emailData) {
        // Ensure hasNotified is included in the cached data
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

            // Sort by date
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
            // First check cache for contact emails
            const cachedEmails = this.loadEmailsFromCache();
            const contactEmails = cachedEmails.filter(e => {
                const fromMatch = e.from.includes(email);
                const toMatch = e.to.includes(email);
                return fromMatch || toMatch;
            });

            // Fetch new messages for this contact with reply status
            const messages = await this.listMessages({
                email: email,
                maxResults: 50
            });

            // Merge new contact emails with cached ones
            const allContactEmails = this.mergeEmails(contactEmails, messages);

            // Update cache with new emails
            this.updateCacheWithEmails(messages);

            return allContactEmails;
        } catch (error) {
            console.error('Error getting emails for contact:', error);
            // If there's an error fetching new emails, return cached contact emails
            return this.loadEmailsFromCache().filter(e => {
                const fromMatch = e.from.includes(email);
                const toMatch = e.to.includes(email);
                return fromMatch || toMatch;
            });
        }
    }
    async getAllEmails(maxResults = 100, onlyImportant = false, forcedRefresh = false, query = null) {
        try {
            // Load cached emails
            let cachedEmails = this.loadEmailsFromCache();

            // Check if we need to fetch new emails
            const lastRetrievalDate = moment(this.loadLastRetrievalDate(), "YYYY-MM-DD HH:mm");
            const now = moment();
            const needsUpdate = !cachedEmails.length || lastRetrievalDate.isBefore(now, 'minute');

            if (!needsUpdate && !forcedRefresh) {
                return cachedEmails;
            }

            // Fetch list of messages (IDs only)
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

            // Separate messages into cached and new
            const messagesToProcess = [];
            const processedEmails = [];

            for (const message of messageList) {
                if (this.emailCache.has(message.id)) {
                    processedEmails.push(this.emailCache.get(message.id));
                } else {
                    messagesToProcess.push(message);
                }
            }

            // Process new messages
            const newEmails = await this.processMessageBatch(messagesToProcess);

            // Merge all emails
            const allEmails = this.mergeEmails(cachedEmails, newEmails);

            // Save updated cache
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
            // Reset last retrieval date to get all emails
            this.lastRetrievalDate = moment().subtract(1, 'year').format('YYYY/MM/DD');
            const messages = await this.listMessages({
                maxResults: 500 // Adjust this number as needed
            });
            const emails = await this.processMessageBatch(messages);
            this.saveEmailsToCache(emails);
            this.saveLastRetrievalDate(); // Save new retrieval date
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