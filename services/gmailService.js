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

            let query = '';
            if (options.email) {
                // Search for emails to/from specific address
                query = `{to:${options.email} from:${options.email}}`;
            } else {
                // For general inbox, use the last retrieval date
                query = `(in:inbox)`; // after:${this.lastRetrievalDate}

            }

            const res = await gmail.users.messages.list({
                userId: 'me',
                maxResults: options.maxResults || 100,
                q: query
            });

            // If this was a full inbox retrieval (not contact-specific),
            // update the last retrieval date
            if (!options.email) {
                this.saveLastRetrievalDate();
            }

            return res.data.messages || [];
        } catch (error) {
            console.error('Error listing messages:', error);
            throw error;
        }
    }

    async getMessage(messageId) {
        try {
            // Check cache first
            if (this.emailCache.has(messageId)) {
                return this.emailCache.get(messageId);
            }

            const auth = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth });
            const res = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full'
            });
            return res.data;
        } catch (error) {
            console.error('Error getting message:', error);
            throw error;
        }
    }

    async parseEmailContent(message) {
        const payload = message.payload;
        let emailBody = '';

        if (payload.parts) {
            for (const part of payload.parts) {
                if (part.mimeType === 'text/plain') {
                    emailBody += Buffer.from(part.body.data, 'base64').toString('utf-8');
                }
            }
        } else if (payload.body && payload.body.data) {
            emailBody = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        }

        return emailBody;
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
                const content = await this.parseEmailContent(fullMessage);

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

                // Add to cache
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
            const lastRetrievalDate = moment(this.loadLastRetrievalDate(),"YYYY/MM/DD");
            const now = moment();
            const needsUpdate = !cachedEmails.length || lastRetrievalDate.isBefore(now, 'day');

            if (needsUpdate) {
                // Fetch only new emails since last retrieval
                const messages = await this.listMessages({
                    maxResults,
                    onlyImportant
                });

                const newEmails = await this.processMessageBatch(messages);

                // Merge new emails with cached ones
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

            // If we have cached emails for this contact and they're recent enough, use them
            const lastRetrievalDate = moment(this.loadLastRetrievalDate());
            const now = moment();
            const needsUpdate = !contactEmails.length || lastRetrievalDate.isBefore(now, 'day');

            if (needsUpdate) {
                const messages = await this.listMessages({
                    email: email,
                    maxResults: 50
                });

                const newEmails = await this.processMessageBatch(messages);

                // Merge new contact emails with cached ones
                const allContactEmails = this.mergeEmails(contactEmails, newEmails);

                // Update cache with new emails
                this.updateCacheWithEmails(newEmails);

                return allContactEmails;
            }

            return contactEmails;
        } catch (error) {
            console.error('Error getting emails for contact:', error);
            // If there's an error fetching new emails, return cached contact emails
            const cachedEmails = this.loadEmailsFromCache();
            return cachedEmails.filter(e => {
                const fromMatch = e.from.includes(email);
                const toMatch = e.to.includes(email);
                return fromMatch || toMatch;
            });
        }
    }
    mergeEmails(cachedEmails, newEmails) {
        // Create a map of existing email IDs
        const emailMap = new Map();
        cachedEmails.forEach(email => emailMap.set(email.id, email));

        // Add or update with new emails
        newEmails.forEach(email => emailMap.set(email.id, email));

        // Convert back to array and sort
        const mergedEmails = Array.from(emailMap.values());
        return mergedEmails.sort((a, b) => {
            return new Date(b.internalDate) - new Date(a.internalDate);
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