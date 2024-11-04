const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const moment = require('moment');

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

            // Get messages from both inbox and sent folders
            const inboxQuery = options.email ?
                `{to:${options.email} from:${options.email}}` :
                'in:inbox';

            const sentQuery = options.email ?
                `from:me to:${options.email}` :
                'in:sent';

            // Fetch both inbox and sent messages
            const [inboxResponse, sentResponse] = await Promise.all([
                gmail.users.messages.list({
                    userId: 'me',
                    maxResults: options.maxResults || 100,
                    q: inboxQuery,
                    orderBy: 'internalDate desc'
                }),
                gmail.users.messages.list({
                    userId: 'me',
                    maxResults: options.maxResults || 100,
                    q: sentQuery,
                    orderBy: 'internalDate desc'
                })
            ]);

            // Combine messages and get unique thread IDs
            const inboxMessages = inboxResponse.data.messages || [];
            const sentMessages = sentResponse.data.messages || [];

            // Create a map of threads and their messages
            const threadMap = new Map();

            // Process inbox messages
            for (const message of inboxMessages) {
                if (!threadMap.has(message.threadId)) {
                    threadMap.set(message.threadId, {
                        messages: [message],
                        hasReplies: false
                    });
                } else {
                    threadMap.get(message.threadId).messages.push(message);
                }
            }

            // Process sent messages and mark threads as replied
            for (const message of sentMessages) {
                if (threadMap.has(message.threadId)) {
                    threadMap.get(message.threadId).hasReplies = true;
                }
            }

            // Get full message details for inbox messages with reply status
            const processedMessages = await this.processMessageBatch(
                inboxMessages,
                threadMap
            );

            // If this was a full inbox retrieval (not contact-specific),
            // update the last retrieval date
            if (!options.email) {
                this.saveLastRetrievalDate();
            }

            return processedMessages;
        } catch (error) {
            console.error('Error listing messages:', error);
            throw error;
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
    async processMessageBatch(messages, threadMap) {
        if (!messages || !messages.length) return [];

        const asyncLib = require('async');
        let processedEmails = [];

        await asyncLib.eachLimit(messages, 5, async (message) => {
            try {
                // Check cache first
                if (this.emailCache.has(message.id)) {
                    const cachedEmail = this.emailCache.get(message.id);
                    // Update replied status even for cached emails
                    cachedEmail.replied = threadMap.get(message.threadId)?.hasReplies || false;
                    processedEmails.push(cachedEmail);
                    return;
                }

                const fullMessage = await this.getMessage(message.id);

                const emailData = {
                    id: message.id,
                    threadId: fullMessage.threadId,
                    from: fullMessage.payload.headers.find(h => h.name === 'From')?.value || '',
                    to: fullMessage.payload.headers.find(h => h.name === 'To')?.value || '',
                    subject: fullMessage.payload.headers.find(h => h.name === 'Subject')?.value || '',
                    timestamp: fullMessage.payload.headers.find(h => h.name === 'Date')?.value || '',
                    internalDate: fullMessage.internalDate,
                    text: fullMessage.parsedContent.text,
                    html: fullMessage.parsedContent.html,
                    labels: fullMessage.labelIds || [],
                    snippet: fullMessage.snippet,
                    replied: threadMap.get(message.threadId)?.hasReplies || false
                };

                this.emailCache.set(message.id, emailData);
                processedEmails.push(emailData);

            } catch (err) {
                console.error(`Error processing message ID ${message.id}:`, err);
            }
        });

        // Sort by internalDate (newest first)
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
    async processMessageBatch(messages) {
        if (!messages || !messages.length) return [];

        const asyncLib = require('async');
        let processedEmails = [];

        await asyncLib.eachLimit(messages, 10, async (message) => {
            try {
                // Check cache first
                if (this.emailCache.has(message.id)) {
                    processedEmails.push(this.emailCache.get(message.id));
                    return;
                }

                const fullMessage = await this.getMessage(message.id);
                const content = fullMessage.parsedContent || '';

                const emailData = {
                    id: message.id,
                    threadId: message.threadId,
                    from: fullMessage.payload.headers.find(h => h.name === 'From')?.value || '',
                    to: fullMessage.payload.headers.find(h => h.name === 'To')?.value || '',
                    subject: fullMessage.payload.headers.find(h => h.name === 'Subject')?.value || '',
                    timestamp: fullMessage.payload.headers.find(h => h.name === 'Date')?.value || '',
                    internalDate: fullMessage.internalDate,
                    text: content,
                    labels: fullMessage.labelIds || []
                };

                // If still no content, log warning
                if (!content.trim()) {
                    console.warn(`Warning: No content parsed for message ${message.id}`);
                }

                this.emailCache.set(message.id, emailData);
                processedEmails.push(emailData);

            } catch (err) {
                console.error(`Error processing message ID ${message.id}:`, err);
            }
        });

        return processedEmails.sort((a, b) => {
            return new Date(b.internalDate) - new Date(a.internalDate);
        });
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
                // Fetch new emails first
                const messages = await this.listMessages({
                    maxResults,
                    onlyImportant
                });

                // Process new messages in smaller batches for better performance
                const batchSize = 20;
                let newEmails = [];

                for (let i = 0; i < messages.length; i += batchSize) {
                    const batch = messages.slice(i, i + batchSize);
                    const processedBatch = await this.processMessageBatch(batch);
                    newEmails = newEmails.concat(processedBatch);
                }

                // Merge new emails with cached ones, maintaining order
                const allEmails = this.mergeEmails(cachedEmails, newEmails);

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