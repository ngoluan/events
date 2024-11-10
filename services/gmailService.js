const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const cheerio = require('cheerio');
class GmailService {
    constructor(auth) {
        this.auth = auth;
        this.cacheFilePath = path.join(__dirname, '..', 'data', 'emails.json');
        this.lastRetrievalPath = path.join(__dirname, '..', 'data', 'lastRetrieval.json');
        this.emailCache = new Map();
        this.lastRetrievalDate = this.loadLastRetrievalDate();

        // Ensure data directory exists
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }
    // In gmailService.js class
    async sendEmail(to, subject, html) {
        try {
            const authClient = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth: authClient });

            // Create the email content
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

            // The body needs to be base64url encoded
            const encodedMessage = Buffer.from(message)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
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
        // Default to 7 days ago if no date found
        return moment().subtract(7, 'days').format('YYYY/MM/DD');
    }

    saveLastRetrievalDate() {
        try {
            const data = {
                lastRetrieval: moment().format('YYYY/MM/DD')
            };
            fs.writeFileSync(this.lastRetrievalPath, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving last retrieval date:', error);
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

            // Now get inbox messages
            const inboxResponse = await gmail.users.messages.list({
                userId: 'me',
                maxResults: options.maxResults || 100,
                q: options.email ? `{to:${options.email} from:${options.email}}` : 'in:inbox',
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

    checkIfReplied(inboxMessage, sentMessages) {
        try {
            const threadId = inboxMessage.threadId;
            let messageId = '';

            // Get Message-ID either from headers or directly from the message
            if (inboxMessage?.payload?.headers) {
                messageId = inboxMessage.payload.headers.find(h => h.name === 'Message-ID')?.value || '';
            }

            const hasReply = sentMessages.some(sentMessage => {
                // Check if the sent message is in the same thread
                if (sentMessage.threadId !== threadId) {
                    return false;
                }

                let inReplyTo = '';
                let references = '';

                // Get References and In-Reply-To either from headers or direct properties
                if (sentMessage?.payload?.headers) {
                    inReplyTo = sentMessage.payload.headers.find(h => h.name === 'In-Reply-To')?.value || '';
                    references = sentMessage.payload.headers.find(h => h.name === 'References')?.value || '';
                } else {
                    inReplyTo = sentMessage.inReplyTo || '';
                    references = sentMessage.references || '';
                }

                // Check message header references if messageId exists
                if (messageId && (inReplyTo.includes(messageId) || references.includes(messageId))) {
                    return true;
                }

                // Check if sent message is newer than inbox message
                const sentDate = new Date(sentMessage.internalDate);
                const inboxDate = new Date(inboxMessage.internalDate);

                // If in same thread and sent message is newer, consider it a reply
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
                    // Process message with headers
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
                } else {
                    // Process message without headers by using direct properties
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
                        replied: fullMessage.replied || this.checkIfReplied(fullMessage, sentMessages) || false
                    };
                }

                // Update cache with processed email data
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
        // Create a map of existing email IDs
        const emailMap = new Map();

        // Add cached emails to map
        cachedEmails.forEach(email => emailMap.set(email.id, email));

        // Add or update with new emails
        newEmails.forEach(email => emailMap.set(email.id, {
            ...email,
            replied: email.replied || false // Ensure replied property exists
        }));

        // Convert back to array and ensure newest first
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
    updateEmailInCache(emailData) {
        // Update in-memory cache
        this.emailCache.set(emailData.id, emailData);

        // Update file cache
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

            // Sort by date before saving
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

    async getAllEmails(maxResults = 100, onlyImportant = false) {
        try {
            // First load from cache
            let cachedEmails = this.loadEmailsFromCache();

            // Check if we need to fetch new emails
            const lastRetrievalDate = moment(this.loadLastRetrievalDate(), "YYYY/MM/DD");
            const now = moment();
            const needsUpdate = !cachedEmails.length || lastRetrievalDate.isBefore(now, 'day');

            if (needsUpdate) {
                // listMessages now returns fully processed messages
                const processedMessages = await this.listMessages({
                    maxResults,
                    onlyImportant
                });

                // Merge new emails with cached ones, maintaining order
                const allEmails = this.mergeEmails(cachedEmails, processedMessages);

                // Save updated cache
                this.saveEmailsToCache(allEmails);

                return allEmails;
            }

            return cachedEmails;
        } catch (error) {
            console.error('Error getting all emails:', error);
            // If there's an error fetching new emails, return cached emails
            return this.loadEmailsFromCache();
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
    async getAllEmails(maxResults = 100, onlyImportant = false) {
        try {
            // First load from cache
            let cachedEmails = this.loadEmailsFromCache();

            // Check if we need to fetch new emails
            const lastRetrievalDate = moment(this.loadLastRetrievalDate(), "YYYY/MM/DD");
            const now = moment();
            const needsUpdate = !cachedEmails.length || lastRetrievalDate.isBefore(now, 'day');

            // listMessages now returns fully processed messages
            const processedMessages = await this.listMessages({
                maxResults,
                onlyImportant
            });

            // Merge new emails with cached ones, maintaining order
            const allEmails = this.mergeEmails(cachedEmails, processedMessages);

            // Save updated cache
            this.saveEmailsToCache(allEmails);

            return allEmails;

            return cachedEmails;
        } catch (error) {
            console.error('Error getting all emails:', error);
            // If there's an error fetching new emails, return cached emails
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