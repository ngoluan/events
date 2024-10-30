
//--- File: /home/luan_ngo/web/events/services/googleCalendarService.js ---

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class GoogleCalendarService {
  constructor(auth) {
    this.credentialsPath = path.join(__dirname, '../credentials.json');
    this.tokenPath = path.join(__dirname, '../token.json');
    this.SCOPES = ['https:

    this.auth = auth;

  }

  async listEvents() {
    const calendar = google.calendar({ version: 'v3', auth: this.auth });
    const res = await calendar.events.list({
      calendarId: 'primary', 
      timeMin: new Date().toISOString(), 
      maxResults: 2500, 
      singleEvents: true,
      orderBy: 'startTime',
    });
    return res.data.items || [];
  }

  async addEvent(eventData) {
    if (!this.auth) {
      this.authorize();
    }
    const calendar = google.calendar({ version: 'v3', auth: this.auth });
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

module.exports = new GoogleCalendarService();


//--- File: /home/luan_ngo/web/events/services/gmailService.js ---
const { google } = require('googleapis');

class GmailService {
    constructor(auth) {
        
        this.googleAuth = auth;
    }

    async listMessages(userEmail, gmailEmail, showCount) {
        try {
            const auth = await this.googleAuth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth });
            const res = await gmail.users.messages.list({
                userId: 'me',
                maxResults: showCount,
                q: gmailEmail ? `to:${gmailEmail}` : ''
            });
            return res.data.messages || [];
        } catch (error) {
            console.error('Error listing messages:', error);
            throw error;
        }
    }

    async getMessage(messageId) {
        try {
            const auth = await this.googleAuth.getOAuth2Client();
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
}


module.exports = new GmailService();

//--- File: /home/luan_ngo/web/events/services/eventService.js ---

const fs = require('fs');
const path = require('path');

const eventsFilePath = path.join(__dirname, '..', 'data', 'events.json');

class EventService {
  loadEvents() {
    if (fs.existsSync(eventsFilePath)) {
      const data = fs.readFileSync(eventsFilePath, 'utf8');
      return JSON.parse(data);
    } else {
      return [];
    }
  }

  saveEvents(events) {
    fs.writeFileSync(eventsFilePath, JSON.stringify(events, null, 2));
  }
}

module.exports = new EventService();


//--- File: /home/luan_ngo/web/events/services/aiService.js ---

const OpenAI = require('openai');
const axios = require('axios');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');


const conversationsPath = path.join(__dirname, '..', 'data', 'conversations.json');

class AIService {
  constructor() {
    
    this.providers = {
      openai: {
        name: 'OpenAI',
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-3.5-turbo',
      },
      
      
      
      
      
      
      
    };

    
    this.currentProvider = 'openai';
  }

  setProvider(providerName) {
    if (this.providers[providerName]) {
      this.currentProvider = providerName;
    } else {
      throw new Error(`AI provider ${providerName} is not supported.`);
    }
  }

  loadConversationHistory() {
    if (fs.existsSync(conversationsPath)) {
      const data = fs.readFileSync(conversationsPath, 'utf8');
      return JSON.parse(data);
    } else {
      return [];
    }
  }

  saveConversationHistory(history) {
    fs.writeFileSync(conversationsPath, JSON.stringify(history, null, 2));
  }

  async generateResponse(messages) {
    try {
      const provider = this.providers[this.currentProvider];
      if (this.currentProvider === 'openai') {
        const openai = new OpenAI({
          apiKey: provider.apiKey,
        });

        const response = await openai.chat.completions.create({
          model: provider.model,
          messages: messages,
        });

        return response.choices[0].message.content;

      } else if (this.currentProvider === 'otherai') {
        
        const response = await axios.post(provider.endpoint, {
          apiKey: provider.apiKey,
          messages: messages,
        });
        return response.data.response;

      } else {
        throw new Error(`AI provider ${this.currentProvider} is not implemented.`);
      }
    } catch (error) {
      console.error('Error generating AI response:', error);
      throw error;
    }
  }
}

module.exports = new AIService();


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

//--- File: /home/luan_ngo/web/events/routes/oauth.js ---
const express = require('express');
const router = express.Router();
const cors = require('cors');



router.use(cors({
    origin: process.env.FRONTEND_URL || 'https:
    credentials: true
}));


router.get('/google', (req, res) => {
    try {
        
        const authUrl = googleAuth.generateAuthUrl();
        
        res.json({ authUrl });
    } catch (error) {
        console.error('Error generating auth URL:', error);
        
        res.redirect(`${process.env.FRONTEND_URL || 'https:
    }
});


router.get('/google/callback', async (req, res) => {
    const code = req.query.code;
    const frontendUrl = process.env.FRONTEND_URL || 'https:
    
    if (!code) {
        return res.redirect(`${frontendUrl}?oauth=error&message=No_authorization_code`);
    }

    try {
        const result = await googleAuth.handleCallback(code);
        if (result.success) {
            
            req.session.userEmail = result.email;
            
            
            res.redirect(`${frontendUrl}?oauth=success`);
        } else {
            throw new Error(result.error || 'Authentication failed');
        }
    } catch (error) {
        console.error('Error handling OAuth callback:', error);
        res.redirect(`${frontendUrl}?oauth=error&message=${encodeURIComponent(error.message)}`);
    }
});

module.exports = router;

//--- File: /home/luan_ngo/web/events/routes/gmail.js ---
const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');


router.get('/readGmail', async (req, res) => {
    try {
        const email = req.query.email || 'all';
        const showCount = parseInt(req.query.showCount) || 25;

        console.log(`Reading Gmail for ${email}, count: ${showCount}`);
        const messages = await gmailService.listMessages(email);
        
        
        const fullMessages = await Promise.all(
            messages.map(async (message) => {
                const fullMessage = await gmailService.getMessage(message.id);
                const content = await gmailService.parseEmailContent(fullMessage);
                return {
                    id: message.id,
                    from: fullMessage.payload.headers.find(h => h.name === 'From')?.value || '',
                    to: fullMessage.payload.headers.find(h => h.name === 'To')?.value || '',
                    subject: fullMessage.payload.headers.find(h => h.name === 'Subject')?.value || '',
                    timestamp: fullMessage.payload.headers.find(h => h.name === 'Date')?.value || '',
                    text: content,
                    labels: fullMessage.labelIds || []
                };
            })
        );

        res.json(fullMessages);
    } catch (error) {
        console.error('Error reading Gmail:', error);
        res.status(500).json({ 
            error: 'Error reading Gmail',
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

module.exports = router;

//--- File: /home/luan_ngo/web/events/routes/events.js ---

const express = require('express');
const router = express.Router();
const eventService = require('../services/eventService');
const pdfService = require('../services/pdfService');
const googleCalendarService = require('../services/googleCalendarService');


router.get('/', (req, res) => {
  const events = eventService.loadEvents();
  res.json(events);
});


router.post('/', (req, res) => {
  const events = eventService.loadEvents();
  const newEvent = req.body;
  newEvent.id = events.length > 0 ? events[events.length - 1].id + 1 : 1;
  events.push(newEvent);
  eventService.saveEvents(events);
  res.json(newEvent);
});


router.put('/:id', (req, res) => {
  const events = eventService.loadEvents();
  const eventId = parseInt(req.params.id);
  const index = events.findIndex((e) => e.id === eventId);
  if (index !== -1) {
    events[index] = req.body;
    eventService.saveEvents(events);
    res.json(events[index]);
  } else {
    res.status(404).send('Event not found');
  }
});


router.delete('/:id', (req, res) => {
  const events = eventService.loadEvents();
  const eventId = parseInt(req.params.id);
  const index = events.findIndex((e) => e.id === eventId);
  if (index !== -1) {
    events.splice(index, 1);
    eventService.saveEvents(events);
    res.sendStatus(200);
  } else {
    res.status(404).send('Event not found');
  }
});


router.post('/:id/contract', async (req, res) => {
  const events = eventService.loadEvents();
  const eventId = parseInt(req.params.id);
  const event = events.find((e) => e.id === eventId);
  if (event) {
    try {
      const { fileName, filePath } = await pdfService.generateContract(event);
      res.json({ fileName, filePath });
    } catch (error) {
      console.error('Error generating contract:', error);
      res.status(500).send('Error generating contract');
    }
  } else {
    res.status(404).send('Event not found');
  }
});
router.get('/getEventsContacts', (req, res) => {
  const events = eventService.loadEvents();
  res.json(events);
});


router.get('/calendar/events', async (req, res) => {
  try {
    const events = await googleCalendarService.listEvents();
    res.json(events);
  } catch (error) {
    console.error('Error listing calendar events:', error);
    res.status(500).send('Error listing calendar events');
  }
});


router.post('/calendar/events', async (req, res) => {
  const eventData = req.body;
  try {
    const event = await googleCalendarService.addEvent(eventData);
    res.json(event);
  } catch (error) {
    console.error('Error adding event to calendar:', error);
    res.status(500).send('Error adding event to calendar');
  }
});

module.exports = router;


//--- File: /home/luan_ngo/web/events/routes/calendar.js ---


const express = require('express');
const router = express.Router();
const googleCalendarService = require('../services/googleCalendarService');

router.get('/getEventCalendar', async (req, res) => {
  try {
    
    await googleCalendarService.authorize();

    
    const events = await googleCalendarService.listEvents();

    
    res.json(events);
  } catch (error) {
    console.error('Error fetching events from Google Calendar:', error);
    res.status(500).send('Error fetching events from Google Calendar');
  }
});

module.exports = router;


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

    
    let conversationHistory = aiService.loadConversationHistory();

    
    conversationHistory.push(...messages);

    
    const aiResponse = await aiService.generateResponse(conversationHistory);

    
    conversationHistory.push({ role: 'assistant', content: aiResponse });

    
    aiService.saveConversationHistory(conversationHistory);

    res.json({ response: aiResponse });
  } catch (error) {
    res.status(500).json({ error: 'AI service error' });
  }
});


router.post('/reset', (req, res) => {
  aiService.saveConversationHistory([]);
  res.json({ message: 'Conversation history reset' });
});

module.exports = router;


//--- File: /home/luan_ngo/web/events/public/scripts.js ---



export class EventManageApp {
    constructor() {
        
        this.mainCalendar = null;
        this.contacts = [];
        this.currentId = -1;

        
        this.templates = {};
        this.userEmail = ''; 

    }

    async init() {
        
        this.sounds = {
            orderUp: new Howl({ src: ['./orderup.m4a'] })
        };

        
        await this.loadTemplates();

        
        this.registerEvents();

        
        this.getAllContacts();
        this.createCalendar();
        this.readGmail("all", false);

        
        this.setupUI();

        
        $('[data-tip="tooltip"]').tooltip();

        
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('oauth') === 'success') {
            
            const response = await $.get('/api/getConnectedEmail');
            if (response.email) {
                this.setConnectedEmail(response.email);
            }
        }
    }
    async initiateGoogleOAuth() {
        try {
            const response = await $.get('/oauth/google');
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
            const response = await $.post(endpoint, data);
            return response;
        } catch (error) {
            console.error(`Failed to send AI request to ${endpoint}:`, error);
            this.utils.alert(`Failed to process AI request.`);
            throw error;
        }
    }

    async generateConfirmationEmail(text, email) {
        const aiPrompt = `Write an email to confirm that the event is tomorrow and some of the key details. Also, ask if they have an updated attendance count and ask about catering choices. Be semi-formal.\n\nEvent details: ${text}\nEmail: ${email}.`;
        return await this.sendAIRequest("/api/sendAIText", { aiText: aiPrompt });
    }

    async getEventDetailsFromEmail(text, email) {
        text += ` Email: ${email}`;
        this.utils.alert("Sending to AI");
        text = this.templates.eventPrompt + text;

        try {
            const data = await this.sendAIRequest("/api/sendAIText", { aiText: text });
            const regex = /{[^{}]*}/;
            const match = data.match(regex);

            if (match) {
                const jsonData = JSON.parse(match[0]);
                const lastId = this.contacts.length > 0 ? this.contacts[this.contacts.length - 1].id : 0;
                jsonData.id = lastId + 1;
                this.contacts.push(jsonData);
                jsonData.name = jsonData.name || "";
                return jsonData.id;
            } else {
                console.log("No JSON-like text found.");
                throw new Error("No JSON-like text found.");
            }
        } catch (error) {
            console.error("Failed to get event details from email:", error);
            throw error;
        }
    }

    async summarizeEmailAI(text) {
        text = text.replace(/[-<>]/g, "").replace(/^Sent:.*$/gm, '').substring(0, 11000);
        const data = await this.sendAIRequest("/api/summarizeAI", { text: text });
        this.writeToAIResult(data.replace(/\n/g, "<br>"));
    }

    async draftEventSpecificEmail(text) {
        const dataSend = {
            aiText: this.templates.emailResponsePrompt + text,
            emailAvailabilityResponsePrompt: this.templates.emailAvailabilityResponsePrompt,
            emailText: text,
            backgroundInfo: this.templates.backgroundInfo
        };

        try {
            const response = await this.sendAIRequest("/api/getAIEmail", dataSend);
            return JSON.parse(response);
        } catch (error) {
            console.error("Error with AI request:", error);
            return { error: "An error occurred while processing the AI request." };
        }
    }

    writeToAIResult(data) {
        data = data.replace(/\n/g, "<br>");
        data = data.replace(/:\[Specific Instructions:.*?\]/g, "");

        const response = `
            <div class="p-2 aiChatReponse">
                <div class="aiChatReponseContent">
                    ${data}
                </div>
                <div class="mt-2">
                    <a href="#" class="btn btn-primary sendToAiFromResult" title="Send to AI from Result">
                        <i class="bi bi-send"></i> Send to AI
                    </a>
                    <button class="btn btn-secondary copyToClipboard ml-2" title="Copy to Clipboard">
                        <i class="bi bi-clipboard"></i> Copy
                    </button>
                </div>
            </div>
        `;
        $("#aiResult").html(response);
    }

    copyAIResponseToClipboard(e) {
        const aiChatResponse = $(e.target).closest(".aiChatReponse");
        let aiContent = aiChatResponse.find(".aiChatReponseContent").text();
        aiContent = aiContent.replace(/:\[Specific Instructions:.*?\]/g, "");

        if (navigator.clipboard && aiContent) {
            navigator.clipboard.writeText(aiContent)
                .then(() => {
                    console.log('AI response copied to clipboard');
                    alert('AI response has been copied to clipboard');
                })
                .catch((err) => {
                    console.error('Could not copy AI response to clipboard: ', err);
                    alert('Failed to copy AI response.');
                });
        } else {
            console.error('Clipboard API not available or AI content is missing');
            alert('Failed to copy AI response.');
        }
    }

    

    registerEvents() {
        
        $(document).on("click", ".copyToClipboard", (e) => {
            e.preventDefault();
            this.copyAIResponseToClipboard(e);
        });

        $(document).on("click", "#confirmAI", (e) => {
            e.preventDefault();
            this.appendConfirmationPrompt();
        });

        $(document).on("click", "#actionSendAI", (e) => {
            e.preventDefault();
            const val = $("#aiText").text() + `\n\nBe concise and semi-formal in the response.`;
            this.sendAIText(val);
        });

        $(document).on("click", "#emailAI", (e) => {
            e.preventDefault();
            this.handleEventSpecificEmail();
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

        $(document).on("click", "#summarizeLastEmails", (e) => {
            e.preventDefault();
            this.summarizeLastEmails();
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
            this.loadContact($(e.target).data("id"));
        });

        $(document).on("click", ".sendToAiFromResult", (e) => {
            e.preventDefault();
            this.sendToAiFromResult(e);
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

    async sendAIText(val) {
        try {
            const data = await $.post("/api/sendAIText", { aiText: val });
            this.writeToAIResult(data);
        } catch (error) {
            console.error("Failed to send AI text:", error);
        }
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

    async handleEventSpecificEmail(text = null) {
        this.utils.alert("Sending to AI");

        if (text === null) {
            const { match, aiText } = this.extractEmail();
            text = match ? match[1].trim() : aiText.replace(/<br>/g, "\n");
        }

        let instructions = prompt("Enter any specific instructions:");
        const combinedText = `${text}\n\n[Specific Instructions: ${instructions}]`;

        try {
            let data = await this.draftEventSpecificEmail(combinedText);
            data.response = data.response.replace(/\n/g, "<br>");
            data.response = data.response.replace(/\[Specific Instructions:.*?\]/g, "");

            $("#aiText").html(data.response + "<br><br> ---------------- <br><br>" + $("#aiText").html());

            if ($("#sendMailEmail").val() === "") {
                $("#sendMailEmail").val(data.fromEmail);
            }
        } catch (error) {
            console.error("Error handling AI response:", error);
        }
    }

    async sendEmail() {
        const aiText = $("#aiText").html();
        const to = $("#sendMailEmail").val();
        const subject = $("#sendEmail").attr("subject");
        if (!confirm("Are you sure you want to send this email?")) return;
        try {
            const data = await $.post("/api/sendEmail", { html: aiText, to: to, subject: subject });
            console.log(data);
            this.utils.alert("Email sent successfully.");
        } catch (error) {
            console.error("Failed to send email:", error);
            this.utils.alert("Failed to send email.");
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
        text = text.replace(/:\[Specific Instructions:.*?\]/g, "");
        $("#aiText").html(`<br><br>${text}`);
        $('html, body').animate({ scrollTop: $("#aiText").offset().top }, 500);
        $("#aiText").focus();
    }

    


    async readGmail(email, retrieveEmail = true) {
        $("#messages .content").html("");

        if (retrieveEmail) {
            try {
                await $.get("/api/retrieveGmail");
                this.utils.alert("Email retrieval complete.");
            } catch (error) {
                console.error("Failed to retrieve Gmail:", error);
            }
        }

        try {
            const data = await $.get("/gmail/readGmail", { email: email, showCount: 25 });
            this.processEmails(data);
        } catch (error) {
            console.error("Failed to read Gmail:", error);
        }
    }

    processEmails(data) {
        data = _.orderBy(data, ["timestamp"], ["desc"]);
        const exclusionArray = ["calendar-notification", "accepted this invitation", "peerspace", "tagvenue"];
        let html = '';

        data.forEach((ele) => {
            if (exclusionArray.some((exclusion) => ele.subject.toLowerCase().includes(exclusion) || ele.text.toLowerCase().includes(exclusion))) {
                return;
            }
            const emailAddressMatch = ele.from.match(/<([^>]+)>/);
            const emailAddress = emailAddressMatch ? emailAddressMatch[1] : ele.from;
            if (emailAddress !== "INTERAC" && ele.text) {
                ele.text = ele.text.replace(/\n/g, "<br>");
            }

            const isUnread = ele.labels.includes("UNREAD");
            const isImportant = ele.labels.includes("IMPORTANT");
            const unreadIcon = isUnread ? `<i class="bi bi-envelope-open-text text-warning" title="Unread"></i> ` : `<i class="bi bi-envelope text-secondary" title="Read"></i> `;
            const importantIcon = isImportant ? `<i class="bi bi-star-fill text-danger" title="Important"></i> ` : "";

            html += `
                <div class="sms" subject="${_.escape(ele.subject)}" to="${_.escape(emailAddress)}" data-id="${_.escape(ele.id)}">
                    <a href="#" class="btn btn-primary toggle-button"><i class="bi bi-three-dots"></i></a>
                    <div class="email">
                        <strong>${unreadIcon}${importantIcon}From:</strong> ${_.escape(ele.from)} <br>
                        <strong>To:</strong> ${_.escape(ele.to)}<br>
                        <strong>Subject:</strong> ${_.escape(ele.subject)}<br>
                        <strong>Time:</strong> ${moment.tz(ele.timestamp, 'America/New_York').format("MM/DD/YYYY HH:mm")}<br>
                        ${ele.text}
                    </div>
                    <a href="#" class="btn btn-primary summarizeEmailAI" title="Summarize">
                        <i class="bi bi-list-task"></i>
                    </a>
                    <a href="#" class="btn btn-primary draftEventSpecificEmail" title="Draft Event Specific Email">
                        <i class="bi bi-pencil"></i>
                    </a>
                    <a href="#" class="btn btn-primary getEventDetails" data-id="${_.escape(ele.id)}" title="Send Event Info to AI">
                        <i class="bi bi-calendar-plus"></i>
                    </a>
                    <a href="#" class="btn btn-primary generateConfirmationEmail" data-id="${_.escape(ele.id)}" title="Generate Confirmation Email">
                        <i class="bi bi-envelope"></i>
                    </a>
                    <a href="#" class="btn btn-primary sendToAiTextArea" subject="${_.escape(ele.subject)}" to="${_.escape(emailAddress)}" data-id="${_.escape(ele.id)}" title="Send to AI textarea">
                        <i class="bi bi-send"></i>
                    </a>
                </div>`;
        });

        $("#messages .content").append(html);
    }

    getAllContacts() {
        $.get("/events/getEventsContacts", (contacts) => {
            this.contacts = contacts;
            const $contactsContent = $("#contacts .content");
            $contactsContent.empty();
            let html = '';

            contacts.slice().reverse().forEach(contact => {
                const date = moment.tz(contact.startTime, 'America/New_York').format("MM/DD/YYYY");
                let colour = "blue";
                if (contact.status) {
                    if (contact.status.includes("depositPaid")) colour = "black";
                    if (contact.status.includes("reserved")) colour = "green";
                }
                if (moment.tz(contact.startTime, 'America/New_York').isBefore(moment().subtract(2, "days"))) {
                    colour = "lightgrey";
                }
                if (!contact.name) return;
                html += `
                    <div class="contactCont" data-id="${_.escape(contact.id)}" data-date="${_.escape(date)}">
                        <a href="#" class="contactBtn" style="color:${_.escape(colour)};" data-id="${_.escape(contact.id)}">${_.escape(contact.name)} (${_.escape(date)})</a>
                    </div>`;
            });

            $contactsContent.append(html);
            console.log("Contacts loaded successfully.");
        });
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
        $("#infoStatus").val(contact.status);
        $("#infoRoom").val(contact.room);
        $("#infoServices").val(contact.services);
        $("#actionsPhone").val(contact.phone || "");
        $("#infoNotes").val(contact.notes || "");
        $("#infoRentalRate").val(contact.rentalRate || "");
        $("#infoMinSpend").val(contact.minSpend || "");
        $("#infoPartyType").val(contact.partyType || "");
        $("#infoAttendance").val(contact.attendance || "");

        this.readGmail(contact.email, false);
        $("#depositPw").html(this.calcDepositPassword(contact));
    }

    calcDepositPassword(contact) {
        return moment.tz(contact.startTime, 'America/New_York').format("MMMMDD");
    }

    

    async createCalendar() {
        this.mainCalendar = new Calendar('calendar');
        try {
            const data = await $.get("/calendar/getEventCalendar");

            
            const eventData = data.map((event, index) => {
                const timezone = 'America/New_York';
                const startTime = moment.tz(event.start.dateTime || event.start.date, timezone);
                const endTime = moment.tz(event.end.dateTime || event.end.date, timezone);

                return {
                    id: index,
                    title: event.summary || 'No Title',
                    startTime: startTime.format(),
                    endTime: endTime.format(),
                    description: event.description || '',
                    room: event.location || ''
                };
            });

            this.mainCalendar.loadEvents(eventData);
        } catch (error) {
            console.error('Error loading calendar events:', error);
        }
    }

    

    saveContactInfo() {
        let contact = _.find(this.contacts, ["id", this.currentId]);
        if (!contact) {
            contact = { id: this.contacts.length + 1 };
            this.contacts.push(contact);
        }
        contact.id = parseInt(contact.id);
        contact.name = $("#infoName").val();
        contact.email = $("#infoEmail").val();
        contact.phone = $("#actionsPhone").val();
        contact.startTime = $("#infoStartTime").val();
        contact.endTime = $("#infoEndTime").val();
        contact.status = $("#infoStatus").val().join(";");
        contact.services = $("#infoServices").val().join(";");
        contact.room = $("#infoRoom").val().join(";");
        contact.rentalRate = $("#infoRentalRate").val();
        contact.minSpend = $("#infoMinSpend").val();
        contact.partyType = $("#infoPartyType").val();
        contact.attendance = $("#infoAttendance").val();
        contact.notes = $("#infoNotes").val();

        $.post("/api/updateEventContact", contact);
        this.utils.alert("Contact saved");
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

        const date = moment(contact.startTime, "YYYY-MM-DD HH:mm").format("MM/DD/YYYY");
        const data = {
            issueDate: moment.tz().tz('America/New_York').format("MM/DD/YYYY"),
            contactName: contact.name,
            email: contact.email,
            phoneNumber: contact.phone,
            reservationDate: date,
            reservationTime: `${moment.tz(contact.startTime, 'America/New_York').format("HH:mm")}-${moment.tz(contact.endTime, 'America/New_York').format("HH:mm")}`,
            room: contact.room.join(","),
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
                window.open(`/files/EventContract_${data.reservationDate.replace(/\
            }
        });
    }

    

    async summarizeLastEmails() {
        try {
            const data = await $.get("/api/readGmail", { email: "all", showCount: 50 });
            let text = `Summarize all these previous email conversations from the last day.\n\n`;
            data.slice(0, 15).forEach(email => {
                const emailText = email.text.replace(/<[^>]*>?/gm, '');
                text += `From: ${email.from}<br>Subject: ${email.subject}<br>Timestamp: ${email.timestamp}<br>To: ${email.to}<br>Text: ${emailText}<br><br>`;
            });
            $("#aiText").html(text);
            const summary = await this.sendAIRequest("/api/sendAIText", { aiText: $("#aiText").text() });
            this.writeToAIResult(summary);
            this.sounds.orderUp.play();
        } catch (error) {
            console.error("Failed to summarize last emails:", error);
        }
    }
}


//--- File: /home/luan_ngo/web/events/public/calendar.js ---
class Calendar {
    constructor(containerId) {
        this.containerId = containerId;
        this.currentDate = new Date();
        this.events = [];
        $(document).ready(() => this.initialize());
    }
    
    showModal(eventDetails) {
        
        eventDetails.labelEndTime = eventDetails.labelEndTime || eventDetails.endTime;

        const modalHTML = `
        <div class="modal fade" id="eventModal" tabindex="-1" aria-labelledby="eventModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="eventModalLabel">${eventDetails.title}</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <p><strong>Room:</strong> ${eventDetails.room}</p>
                        <p><strong>Time:</strong> ${moment(eventDetails.startTime).format('hh:mm')} - ${moment(eventDetails.labelEndTime).format('hh:mm')}</p>
                        <p><strong>Description:</strong> ${eventDetails.description}</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" id="bookNowButton">Book Now</button>
                    </div>
                </div>
            </div>
        </div>
        `;

        
        $('body').append(modalHTML);
        $('#eventModal').modal('show');

        
        $('#eventModal').on('hidden.bs.modal', function () {
            $('#eventModal').remove();
        });

        
        $('#bookNowButton').click(() => {
            alert('Book now action not implemented.');
            $('#eventModal').modal('hide'); 
        });
    }

    
    eventClickHandler(eventId) {
        const eventDetails = this.events.find(event => event.id === eventId);
        if (eventDetails) {
            this.showModal(eventDetails);
        }
    }
    constructHTML() {
        const html = `
        <div class="calendar-header">
            <h4 class="calendar-month-year">
                <span id="month" class="calendar-month"></span>
                <span id="year" class="calendar-year"></span>
                <div class="calendar-nav" style="display: inline-block;">
                    <a id="left" href="#" class="btn btn-outline-primary btn-sm" data-tip="tooltip" title="Previous Month">
                        <i class="bi bi-chevron-left"></i>
                    </a>
                    <a id="right" href="#" class="btn btn-outline-primary btn-sm" data-tip="tooltip" title="Next Month">
                        <i class="bi bi-chevron-right"></i>
                    </a>
                </div>
            </h4>
        </div>
        <div class="row">
            <div class="col-12">
                <table class="table table-bordered">
                    
                </table>
            </div>
        </div>
        `;
        $('#' + this.containerId).html(html);
    }

    loadEvents(events) {
        this.events = events;
        this.refreshCalendar();
    }

    refreshCalendar() {
        this.generateCalendar(this.currentDate);
    }
    generateCalendar(d) {
        const firstDayOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
        const totalDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        let html = '<table class="table calendar"><thead><tr>';
        for (let i = 0; i < 7; i++) {
            html += `<th>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}</th>`;
        }
        html += '</tr></thead><tbody><tr>';

        
        const roomClasses = {
            "DiningRoom": "event-room-1",
            "Lounge": "event-room-2"
            
        };

        
        for (let i = 0; i < firstDayOfMonth; i++) {
            html += '<td></td>'; 
        }

        for (let day = 1; day <= totalDays; day++) {
            const dayDate = new Date(d.getFullYear(), d.getMonth(), day);
            if ((day + firstDayOfMonth - 1) % 7 === 0 && day > 1) {
                html += '</tr><tr>'; 
            }

            html += `<td class="day" data-date="${dayDate.toISOString().split('T')[0]}">${day}`;

            
            const eventsForDay = this.events.filter(event => {
                const eventStart = new Date(event.startTime).setHours(0, 0, 0, 0);
                const eventEnd = new Date(event.endTime).setHours(23, 59, 59, 999);
                return dayDate >= eventStart && dayDate <= eventEnd;
            });

            
            eventsForDay.forEach(event => {
                html += `<div class="event-bar" data-eventid="${event.id}" title="${event.title}: ${event.description}">
          ${event.title}
        </div>`;
            });

            html += `</td>`;
        }

        
        const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth(), totalDays).getDay();
        for (let i = lastDayOfMonth; i < 6; i++) {
            html += '<td></td>'; 
        }

        html += '</tr></tbody></table>';
        $('#' + this.containerId + ' .col-12').html(html);

        
        $('.event-bar').click((e) => {
            const eventId = $(e.target).data('eventid');
            this.eventClickHandler(eventId);
        });

        
        this.updateMonthYear(d);
    }



    updateMonthYear(d) {
        $('#month', '#' + this.containerId).text(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]);
        $('#year', '#' + this.containerId).text(d.getFullYear());

        $('#left', '#' + this.containerId).off('click').click((e) => {
            e.preventDefault();
            this.changeMonth(-1);
        });

        $('#right', '#' + this.containerId).off('click').click((e) => {
            e.preventDefault();
            this.changeMonth(1);
        });
    }

    changeMonth(offset) {
        this.currentDate.setMonth(this.currentDate.getMonth() + offset);
        this.refreshCalendar();
    }

    initialize() {
        this.constructHTML();
        this.refreshCalendar();
    }
}







