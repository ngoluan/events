
//--- File: /home/luan_ngo/web/events/services/pdfService.js ---

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class PDFService {
  generateContract(eventData) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument();

        const fileName = `contract_${eventData.id}.pdf`;
        const filePath = path.join(__dirname, '..', 'contracts', fileName);

        
        const contractsDir = path.join(__dirname, '..', 'contracts');
        if (!fs.existsSync(contractsDir)) {
          fs.mkdirSync(contractsDir);
        }

        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        
        doc.fontSize(20).text('Event Contract', { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Event ID: ${eventData.id}`);
        doc.text(`Name: ${eventData.name}`);
        doc.text(`Email: ${eventData.email}`);
        doc.text(`Phone: ${eventData.phone}`);
        doc.text(`Start Time: ${eventData.startTime}`);
        doc.text(`End Time: ${eventData.endTime}`);
        doc.text(`Services: ${eventData.services.join(', ')}`);
        doc.text(`Notes: ${eventData.notes}`);
        

        doc.end();

        stream.on('finish', () => {
          resolve({ fileName, filePath });
        });

        stream.on('error', (err) => {
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = new PDFService();


//--- File: /home/luan_ngo/web/events/services/googleCalendarService.js ---

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class GoogleCalendarService {
  constructor() {
    this.credentialsPath = path.join(__dirname, '../credentials.json');
    this.tokenPath = path.join(__dirname, '../token.json');
    this.SCOPES = ['https:

    this.auth = null;
  }

  authorize() {
    const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    if (fs.existsSync(this.tokenPath)) {
      const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
      oAuth2Client.setCredentials(token);
      this.auth = oAuth2Client;
    } else {
      throw new Error('Token not found. Please generate a token.');
    }
  }

  async listEvents() {
    if (!this.auth) {
      this.authorize();
    }
    const calendar = google.calendar({ version: 'v3', auth: this.auth });
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
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
const fs = require('fs');
const path = require('path');
const GoogleAuth = require('./GoogleAuth');
class GmailService {
  constructor() {
    this.googleAuth = new GoogleAuth();
  }

  async listMessages(userEmail, gmailEmail, showCount) {
    try {
      const auth = await this.googleAuth.getOAuth2ClientForEmail(userEmail, gmailEmail);
      const gmail = google.gmail({ version: 'v1', auth });
      const res = await gmail.users.messages.list({
        userId: 'me',
        maxResults: showCount,
        q: `to:${gmailEmail}`,
      });
      return res.data.messages || [];
    } catch (error) {
      throw error;
    }
  }

  async getMessage(userEmail, gmailEmail, messageId) {
    try {
      const auth = await this.googleAuth.getOAuth2ClientForEmail(userEmail, gmailEmail);
      const gmail = google.gmail({ version: 'v1', auth });
      const res = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });
      return res.data;
    } catch (error) {
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
const jwt = require('jsonwebtoken');

class GoogleAuth {
    constructor() {
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https:
        this.tokenPath = path.join(__dirname, '../data/tokens.json');
        this.tokens = this.loadTokens();
        this.tokenRefreshThreshold = 5 * 60 * 1000; 
    }

    async getOAuth2ClientForEmail(userEmail, gmailEmail) {
        if (!this.clientId || !this.clientSecret) {
            throw new Error('Missing Google OAuth credentials. Check your environment variables.');
        }

        const oAuth2Client = new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );

        try {
            
            console.log(`Looking for tokens for user: ${userEmail}, gmail: ${gmailEmail}`);
            
            const userTokens = this.tokens.find(user => user.userEmail === userEmail);
            if (!userTokens) {
                console.log('No tokens found for user');
                throw new Error(`No tokens found for user email: ${userEmail}`);
            }

            const account = userTokens.accounts.find(acc => 
                acc.email === gmailEmail && acc.accountType === 'gmail'
            );
            if (!account) {
                console.log('No account found for Gmail');
                throw new Error(`No tokens found for Gmail email: ${gmailEmail}`);
            }

            
            if (this.shouldRefreshToken(account.tokens)) {
                console.log('Refreshing expired token');
                const newTokens = await this.refreshTokens(oAuth2Client, account.tokens);
                account.tokens = newTokens;
                await this.saveTokens();
            }

            oAuth2Client.setCredentials(account.tokens);

            
            oAuth2Client.on('tokens', async (newTokens) => {
                console.log('Received new tokens from Google');
                if (newTokens.refresh_token) {
                    account.tokens.refresh_token = newTokens.refresh_token;
                }
                account.tokens.access_token = newTokens.access_token;
                account.tokens.expiry_date = newTokens.expiry_date;
                
                await this.saveTokens();
            });

            return oAuth2Client;
        } catch (error) {
            console.error('Error in getOAuth2ClientForEmail:', error);
            throw error;
        }
    }

    generateAuthUrl(selectedEmail, userEmail, accountType) {
        const state = jwt.sign(
            { selectedEmail, userEmail, accountType },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        
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
            ],
            state: state
        });
    }

    async handleCallback(code, state) {
        try {
            const decodedState = jwt.verify(state, process.env.JWT_SECRET);
            const { selectedEmail, userEmail, accountType } = decodedState;

            if (!selectedEmail || !userEmail) {
                throw new Error('Invalid state parameter');
            }

            const oAuth2Client = new google.auth.OAuth2(
                this.clientId,
                this.clientSecret,
                this.redirectUri
            );

            const { tokens } = await oAuth2Client.getToken(code);
            
            
            oAuth2Client.setCredentials(tokens);
            const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
            const profile = await gmail.users.getProfile({ userId: 'me' });
            const gmailEmail = profile.data.emailAddress;

            
            await this.saveTokenForEmail(userEmail, gmailEmail, tokens, accountType);

            return { 
                success: true, 
                email: gmailEmail 
            };
        } catch (error) {
            console.error('Error in handleCallback:', error);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    async saveTokenForEmail(userEmail, gmailEmail, tokens, accountType) {
        let userTokens = this.tokens.find(user => user.userEmail === userEmail);
        
        if (!userTokens) {
            userTokens = {
                userEmail,
                accounts: []
            };
            this.tokens.push(userTokens);
        }

        const accountIndex = userTokens.accounts.findIndex(acc => 
            acc.email === gmailEmail && acc.accountType === accountType
        );

        const accountData = {
            email: gmailEmail,
            accountType,
            tokens: {
                ...tokens,
                expiry_date: Date.now() + (tokens.expires_in * 1000)
            }
        };

        if (accountIndex === -1) {
            userTokens.accounts.push(accountData);
        } else {
            userTokens.accounts[accountIndex] = accountData;
        }

        await this.saveTokens();
    }

    shouldRefreshToken(tokens) {
        if (!tokens.expiry_date) return true;
        return tokens.expiry_date - Date.now() <= this.tokenRefreshThreshold;
    }

    async refreshTokens(oAuth2Client, tokens) {
        try {
            oAuth2Client.setCredentials({
                refresh_token: tokens.refresh_token
            });

            const { credentials } = await oAuth2Client.refreshAccessToken();
            return credentials;
        } catch (error) {
            console.error('Error refreshing access token:', error);
            throw error;
        }
    }

    loadTokens() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                const tokensData = fs.readFileSync(this.tokenPath, 'utf8');
                return JSON.parse(tokensData);
            }
        } catch (error) {
            console.error('Error loading tokens:', error);
        }
        return [];
    }

    async saveTokens() {
        try {
            await fs.promises.writeFile(
                this.tokenPath, 
                JSON.stringify(this.tokens, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('Error saving tokens:', error);
            throw error;
        }
    }
}

module.exports = GoogleAuth;

//--- File: /home/luan_ngo/web/events/routes/oauth.js ---


const express = require('express');
const router = express.Router();
const GoogleAuth = require('../services/GoogleAuth');

const googleAuth = new GoogleAuth();


router.get('/google', (req, res) => {


  try {
    const authUrl = googleAuth.generateAuthUrl(selectedEmail, userEmail, accountType);
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).send('Error generating auth URL');
  }
});


router.get('/google/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;

  try {
    const result = await googleAuth.handleCallback(code, state);
    if (result.success) {
      res.redirect('/'); 
    } else {
      res.status(500).send(`Authentication failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    res.status(500).send('Error handling OAuth callback');
  }
});

module.exports = router;


//--- File: /home/luan_ngo/web/events/routes/gmail.js ---

const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');
const aiService = require('../services/aiService');
const eventService = require('../services/eventService');


router.get('/messages', async (req, res) => {
  try {
    const messages = await gmailService.listMessages();
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Gmail service error' });
  }
});


router.get('/messages/:id/parse', async (req, res) => {
  const messageId = req.params.id;
  try {
    const message = await gmailService.getMessage(messageId);

    
    const emailContent = await gmailService.parseEmailContent(message);

    
    const messages = [
      { role: 'system', content: 'You are an assistant that extracts event information from emails and responds in JSON format.' },
      { role: 'user', content: emailContent },
    ];
    const aiResponse = await aiService.generateResponse(messages);

    
    let eventData;
    try {
      eventData = JSON.parse(aiResponse);
    } catch (error) {
      console.error('Error parsing AI response:', error);
      return res.status(500).send('Error parsing AI response');
    }

    
    const events = eventService.loadEvents();
    eventData.id = events.length > 0 ? events[events.length - 1].id + 1 : 1;
    events.push(eventData);
    eventService.saveEvents(events);

    res.json(eventData);

  } catch (error) {
    console.error('Error parsing email:', error);
    res.status(500).json({ error: 'Error parsing email' });
  }
});


router.post('/messages/:id/draft', async (req, res) => {
  const messageId = req.params.id;
  const { responseTemplate } = req.body; 
  try {
    const message = await gmailService.getMessage(messageId);
    const emailContent = await gmailService.parseEmailContent(message);

    
    const messages = [
      { role: 'system', content: 'You are an assistant that drafts email responses based on templates and previous emails.' },
      { role: 'user', content: `Email Content: ${emailContent}\nTemplate: ${responseTemplate}` },
    ];
    const aiResponse = await aiService.generateResponse(messages);

    res.json({ draft: aiResponse });
  } catch (error) {
    console.error('Error drafting email response:', error);
    res.status(500).json({ error: 'Error drafting email response' });
  }
});


router.get('/readGmail', async (req, res) => {
  try {
    const email = req.query.email;
    const showCount = parseInt(req.query.showCount) || 25;

    const messages = await gmailService.listMessages(email, showCount);
    res.json(messages);
  } catch (error) {
    console.error('Error reading Gmail:', error);
    res.status(500).json({ error: 'Error reading Gmail' });
  }
});

module.exports = router;


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
const fs = require('fs');
const path = require('path');


router.get('/getEventCalendar', (req, res) => {
  const calendarFilePath = path.join(__dirname, 'path_to_your_calendar_file.ics');

  fs.readFile(calendarFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading calendar file:', err);
      return res.status(500).send('Error reading calendar file');
    }
    res.send(data);
  });
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


//--- File: /home/luan_ngo/web/events/public/styles.css ---
*, ::before, ::after {
  --tw-border-spacing-x: 0;
  --tw-border-spacing-y: 0;
  --tw-translate-x: 0;
  --tw-translate-y: 0;
  --tw-rotate: 0;
  --tw-skew-x: 0;
  --tw-skew-y: 0;
  --tw-scale-x: 1;
  --tw-scale-y: 1;
  --tw-pan-x:  ;
  --tw-pan-y:  ;
  --tw-pinch-zoom:  ;
  --tw-scroll-snap-strictness: proximity;
  --tw-gradient-from-position:  ;
  --tw-gradient-via-position:  ;
  --tw-gradient-to-position:  ;
  --tw-ordinal:  ;
  --tw-slashed-zero:  ;
  --tw-numeric-figure:  ;
  --tw-numeric-spacing:  ;
  --tw-numeric-fraction:  ;
  --tw-ring-inset:  ;
  --tw-ring-offset-width: 0px;
  --tw-ring-offset-color: #fff;
  --tw-ring-color: rgb(59 130 246 / 0.5);
  --tw-ring-offset-shadow: 0 0 #0000;
  --tw-ring-shadow: 0 0 #0000;
  --tw-shadow: 0 0 #0000;
  --tw-shadow-colored: 0 0 #0000;
  --tw-blur:  ;
  --tw-brightness:  ;
  --tw-contrast:  ;
  --tw-grayscale:  ;
  --tw-hue-rotate:  ;
  --tw-invert:  ;
  --tw-saturate:  ;
  --tw-sepia:  ;
  --tw-drop-shadow:  ;
  --tw-backdrop-blur:  ;
  --tw-backdrop-brightness:  ;
  --tw-backdrop-contrast:  ;
  --tw-backdrop-grayscale:  ;
  --tw-backdrop-hue-rotate:  ;
  --tw-backdrop-invert:  ;
  --tw-backdrop-opacity:  ;
  --tw-backdrop-saturate:  ;
  --tw-backdrop-sepia:  ;
  --tw-contain-size:  ;
  --tw-contain-layout:  ;
  --tw-contain-paint:  ;
  --tw-contain-style:  ;
}

::backdrop {
  --tw-border-spacing-x: 0;
  --tw-border-spacing-y: 0;
  --tw-translate-x: 0;
  --tw-translate-y: 0;
  --tw-rotate: 0;
  --tw-skew-x: 0;
  --tw-skew-y: 0;
  --tw-scale-x: 1;
  --tw-scale-y: 1;
  --tw-pan-x:  ;
  --tw-pan-y:  ;
  --tw-pinch-zoom:  ;
  --tw-scroll-snap-strictness: proximity;
  --tw-gradient-from-position:  ;
  --tw-gradient-via-position:  ;
  --tw-gradient-to-position:  ;
  --tw-ordinal:  ;
  --tw-slashed-zero:  ;
  --tw-numeric-figure:  ;
  --tw-numeric-spacing:  ;
  --tw-numeric-fraction:  ;
  --tw-ring-inset:  ;
  --tw-ring-offset-width: 0px;
  --tw-ring-offset-color: #fff;
  --tw-ring-color: rgb(59 130 246 / 0.5);
  --tw-ring-offset-shadow: 0 0 #0000;
  --tw-ring-shadow: 0 0 #0000;
  --tw-shadow: 0 0 #0000;
  --tw-shadow-colored: 0 0 #0000;
  --tw-blur:  ;
  --tw-brightness:  ;
  --tw-contrast:  ;
  --tw-grayscale:  ;
  --tw-hue-rotate:  ;
  --tw-invert:  ;
  --tw-saturate:  ;
  --tw-sepia:  ;
  --tw-drop-shadow:  ;
  --tw-backdrop-blur:  ;
  --tw-backdrop-brightness:  ;
  --tw-backdrop-contrast:  ;
  --tw-backdrop-grayscale:  ;
  --tw-backdrop-hue-rotate:  ;
  --tw-backdrop-invert:  ;
  --tw-backdrop-opacity:  ;
  --tw-backdrop-saturate:  ;
  --tw-backdrop-sepia:  ;
  --tw-contain-size:  ;
  --tw-contain-layout:  ;
  --tw-contain-paint:  ;
  --tw-contain-style:  ;
}





*,
::before,
::after {
  box-sizing: border-box;
  
  border-width: 0;
  
  border-style: solid;
  
  border-color: #e5e7eb;
  
}

::before,
::after {
  --tw-content: '';
}



html,
:host {
  line-height: 1.5;
  
  -webkit-text-size-adjust: 100%;
  
  -moz-tab-size: 4;
  
  -o-tab-size: 4;
     tab-size: 4;
  
  font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  
  font-feature-settings: normal;
  
  font-variation-settings: normal;
  
  -webkit-tap-highlight-color: transparent;
  
}



body {
  margin: 0;
  
  line-height: inherit;
  
}



hr {
  height: 0;
  
  color: inherit;
  
  border-top-width: 1px;
  
}



abbr:where([title]) {
  -webkit-text-decoration: underline dotted;
          text-decoration: underline dotted;
}



h1,
h2,
h3,
h4,
h5,
h6 {
  font-size: inherit;
  font-weight: inherit;
}



a {
  color: inherit;
  text-decoration: inherit;
}



b,
strong {
  font-weight: bolder;
}



code,
kbd,
samp,
pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  
  font-feature-settings: normal;
  
  font-variation-settings: normal;
  
  font-size: 1em;
  
}



small {
  font-size: 80%;
}



sub,
sup {
  font-size: 75%;
  line-height: 0;
  position: relative;
  vertical-align: baseline;
}

sub {
  bottom: -0.25em;
}

sup {
  top: -0.5em;
}



table {
  text-indent: 0;
  
  border-color: inherit;
  
  border-collapse: collapse;
  
}



button,
input,
optgroup,
select,
textarea {
  font-family: inherit;
  
  font-feature-settings: inherit;
  
  font-variation-settings: inherit;
  
  font-size: 100%;
  
  font-weight: inherit;
  
  line-height: inherit;
  
  letter-spacing: inherit;
  
  color: inherit;
  
  margin: 0;
  
  padding: 0;
  
}



button,
select {
  text-transform: none;
}



button,
input:where([type='button']),
input:where([type='reset']),
input:where([type='submit']) {
  -webkit-appearance: button;
  
  background-color: transparent;
  
  background-image: none;
  
}



:-moz-focusring {
  outline: auto;
}



:-moz-ui-invalid {
  box-shadow: none;
}



progress {
  vertical-align: baseline;
}



::-webkit-inner-spin-button,
::-webkit-outer-spin-button {
  height: auto;
}



[type='search'] {
  -webkit-appearance: textfield;
  
  outline-offset: -2px;
  
}



::-webkit-search-decoration {
  -webkit-appearance: none;
}



::-webkit-file-upload-button {
  -webkit-appearance: button;
  
  font: inherit;
  
}



summary {
  display: list-item;
}



blockquote,
dl,
dd,
h1,
h2,
h3,
h4,
h5,
h6,
hr,
figure,
p,
pre {
  margin: 0;
}

fieldset {
  margin: 0;
  padding: 0;
}

legend {
  padding: 0;
}

ol,
ul,
menu {
  list-style: none;
  margin: 0;
  padding: 0;
}



dialog {
  padding: 0;
}



textarea {
  resize: vertical;
}



input::-moz-placeholder, textarea::-moz-placeholder {
  opacity: 1;
  
  color: #9ca3af;
  
}

input::placeholder,
textarea::placeholder {
  opacity: 1;
  
  color: #9ca3af;
  
}



button,
[role="button"] {
  cursor: pointer;
}



:disabled {
  cursor: default;
}



img,
svg,
video,
canvas,
audio,
iframe,
embed,
object {
  display: block;
  
  vertical-align: middle;
  
}



img,
video {
  max-width: 100%;
  height: auto;
}



[hidden]:where(:not([hidden="until-found"])) {
  display: none;
}

:root,
[data-theme] {
  background-color: var(--fallback-b1,oklch(var(--b1)/1));
  color: var(--fallback-bc,oklch(var(--bc)/1));
}

@supports not (color: oklch(0% 0 0)) {
  :root {
    color-scheme: light;
    --fallback-p: #491eff;
    --fallback-pc: #d4dbff;
    --fallback-s: #ff41c7;
    --fallback-sc: #fff9fc;
    --fallback-a: #00cfbd;
    --fallback-ac: #00100d;
    --fallback-n: #2b3440;
    --fallback-nc: #d7dde4;
    --fallback-b1: #ffffff;
    --fallback-b2: #e5e6e6;
    --fallback-b3: #e5e6e6;
    --fallback-bc: #1f2937;
    --fallback-in: #00b3f0;
    --fallback-inc: #000000;
    --fallback-su: #00ca92;
    --fallback-suc: #000000;
    --fallback-wa: #ffc22d;
    --fallback-wac: #000000;
    --fallback-er: #ff6f70;
    --fallback-erc: #000000;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --fallback-p: #7582ff;
      --fallback-pc: #050617;
      --fallback-s: #ff71cf;
      --fallback-sc: #190211;
      --fallback-a: #00c7b5;
      --fallback-ac: #000e0c;
      --fallback-n: #2a323c;
      --fallback-nc: #a6adbb;
      --fallback-b1: #1d232a;
      --fallback-b2: #191e24;
      --fallback-b3: #15191e;
      --fallback-bc: #a6adbb;
      --fallback-in: #00b3f0;
      --fallback-inc: #000000;
      --fallback-su: #00ca92;
      --fallback-suc: #000000;
      --fallback-wa: #ffc22d;
      --fallback-wac: #000000;
      --fallback-er: #ff6f70;
      --fallback-erc: #000000;
    }
  }
}

html {
  -webkit-tap-highlight-color: transparent;
}

* {
  scrollbar-color: color-mix(in oklch, currentColor 35%, transparent) transparent;
}

*:hover {
  scrollbar-color: color-mix(in oklch, currentColor 60%, transparent) transparent;
}

:root {
  color-scheme: light;
  --in: 72.06% 0.191 231.6;
  --su: 64.8% 0.150 160;
  --wa: 84.71% 0.199 83.87;
  --er: 71.76% 0.221 22.18;
  --pc: 89.824% 0.06192 275.75;
  --ac: 15.352% 0.0368 183.61;
  --inc: 0% 0 0;
  --suc: 0% 0 0;
  --wac: 0% 0 0;
  --erc: 0% 0 0;
  --rounded-box: 1rem;
  --rounded-btn: 0.5rem;
  --rounded-badge: 1.9rem;
  --animation-btn: 0.25s;
  --animation-input: .2s;
  --btn-focus-scale: 0.95;
  --border-btn: 1px;
  --tab-border: 1px;
  --tab-radius: 0.5rem;
  --p: 49.12% 0.3096 275.75;
  --s: 69.71% 0.329 342.55;
  --sc: 98.71% 0.0106 342.55;
  --a: 76.76% 0.184 183.61;
  --n: 32.1785% 0.02476 255.701624;
  --nc: 89.4994% 0.011585 252.096176;
  --b1: 100% 0 0;
  --b2: 96.1151% 0 0;
  --b3: 92.4169% 0.00108 197.137559;
  --bc: 27.8078% 0.029596 256.847952;
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --in: 72.06% 0.191 231.6;
    --su: 64.8% 0.150 160;
    --wa: 84.71% 0.199 83.87;
    --er: 71.76% 0.221 22.18;
    --pc: 13.138% 0.0392 275.75;
    --sc: 14.96% 0.052 342.55;
    --ac: 14.902% 0.0334 183.61;
    --inc: 0% 0 0;
    --suc: 0% 0 0;
    --wac: 0% 0 0;
    --erc: 0% 0 0;
    --rounded-box: 1rem;
    --rounded-btn: 0.5rem;
    --rounded-badge: 1.9rem;
    --animation-btn: 0.25s;
    --animation-input: .2s;
    --btn-focus-scale: 0.95;
    --border-btn: 1px;
    --tab-border: 1px;
    --tab-radius: 0.5rem;
    --p: 65.69% 0.196 275.75;
    --s: 74.8% 0.26 342.55;
    --a: 74.51% 0.167 183.61;
    --n: 31.3815% 0.021108 254.139175;
    --nc: 74.6477% 0.0216 264.435964;
    --b1: 25.3267% 0.015896 252.417568;
    --b2: 23.2607% 0.013807 253.100675;
    --b3: 21.1484% 0.01165 254.087939;
    --bc: 74.6477% 0.0216 264.435964;
  }
}

[data-theme=light] {
  color-scheme: light;
  --in: 72.06% 0.191 231.6;
  --su: 64.8% 0.150 160;
  --wa: 84.71% 0.199 83.87;
  --er: 71.76% 0.221 22.18;
  --pc: 89.824% 0.06192 275.75;
  --ac: 15.352% 0.0368 183.61;
  --inc: 0% 0 0;
  --suc: 0% 0 0;
  --wac: 0% 0 0;
  --erc: 0% 0 0;
  --rounded-box: 1rem;
  --rounded-btn: 0.5rem;
  --rounded-badge: 1.9rem;
  --animation-btn: 0.25s;
  --animation-input: .2s;
  --btn-focus-scale: 0.95;
  --border-btn: 1px;
  --tab-border: 1px;
  --tab-radius: 0.5rem;
  --p: 49.12% 0.3096 275.75;
  --s: 69.71% 0.329 342.55;
  --sc: 98.71% 0.0106 342.55;
  --a: 76.76% 0.184 183.61;
  --n: 32.1785% 0.02476 255.701624;
  --nc: 89.4994% 0.011585 252.096176;
  --b1: 100% 0 0;
  --b2: 96.1151% 0 0;
  --b3: 92.4169% 0.00108 197.137559;
  --bc: 27.8078% 0.029596 256.847952;
}

[data-theme=dark] {
  color-scheme: dark;
  --in: 72.06% 0.191 231.6;
  --su: 64.8% 0.150 160;
  --wa: 84.71% 0.199 83.87;
  --er: 71.76% 0.221 22.18;
  --pc: 13.138% 0.0392 275.75;
  --sc: 14.96% 0.052 342.55;
  --ac: 14.902% 0.0334 183.61;
  --inc: 0% 0 0;
  --suc: 0% 0 0;
  --wac: 0% 0 0;
  --erc: 0% 0 0;
  --rounded-box: 1rem;
  --rounded-btn: 0.5rem;
  --rounded-badge: 1.9rem;
  --animation-btn: 0.25s;
  --animation-input: .2s;
  --btn-focus-scale: 0.95;
  --border-btn: 1px;
  --tab-border: 1px;
  --tab-radius: 0.5rem;
  --p: 65.69% 0.196 275.75;
  --s: 74.8% 0.26 342.55;
  --a: 74.51% 0.167 183.61;
  --n: 31.3815% 0.021108 254.139175;
  --nc: 74.6477% 0.0216 264.435964;
  --b1: 25.3267% 0.015896 252.417568;
  --b2: 23.2607% 0.013807 253.100675;
  --b3: 21.1484% 0.01165 254.087939;
  --bc: 74.6477% 0.0216 264.435964;
}

[data-theme=cupcake] {
  color-scheme: light;
  --in: 72.06% 0.191 231.6;
  --su: 64.8% 0.150 160;
  --wa: 84.71% 0.199 83.87;
  --er: 71.76% 0.221 22.18;
  --pc: 15.2344% 0.017892 200.026556;
  --sc: 15.787% 0.020249 356.29965;
  --ac: 15.8762% 0.029206 78.618794;
  --nc: 84.7148% 0.013247 313.189598;
  --inc: 0% 0 0;
  --suc: 0% 0 0;
  --wac: 0% 0 0;
  --erc: 0% 0 0;
  --rounded-box: 1rem;
  --rounded-badge: 1.9rem;
  --animation-btn: 0.25s;
  --animation-input: .2s;
  --btn-focus-scale: 0.95;
  --border-btn: 1px;
  --p: 76.172% 0.089459 200.026556;
  --s: 78.9351% 0.101246 356.29965;
  --a: 79.3811% 0.146032 78.618794;
  --n: 23.5742% 0.066235 313.189598;
  --b1: 97.7882% 0.00418 56.375637;
  --b2: 93.9822% 0.007638 61.449292;
  --b3: 91.5861% 0.006811 53.440502;
  --bc: 23.5742% 0.066235 313.189598;
  --rounded-btn: 1.9rem;
  --tab-border: 2px;
  --tab-radius: 0.7rem;
}

.container {
  width: 100%;
}

@media (min-width: 640px) {
  .container {
    max-width: 640px;
  }
}

@media (min-width: 768px) {
  .container {
    max-width: 768px;
  }
}

@media (min-width: 1024px) {
  .container {
    max-width: 1024px;
  }
}

@media (min-width: 1280px) {
  .container {
    max-width: 1280px;
  }
}

@media (min-width: 1536px) {
  .container {
    max-width: 1536px;
  }
}

.alert {
  display: grid;
  width: 100%;
  grid-auto-flow: row;
  align-content: flex-start;
  align-items: center;
  justify-items: center;
  gap: 1rem;
  text-align: center;
  border-radius: var(--rounded-box, 1rem);
  border-width: 1px;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-border-opacity)));
  padding: 1rem;
  --tw-text-opacity: 1;
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
  --alert-bg: var(--fallback-b2,oklch(var(--b2)/1));
  --alert-bg-mix: var(--fallback-b1,oklch(var(--b1)/1));
  background-color: var(--alert-bg);
}

@media (min-width: 640px) {
  .alert {
    grid-auto-flow: column;
    grid-template-columns: auto minmax(auto,1fr);
    justify-items: start;
    text-align: start;
  }
}

.avatar.placeholder > div {
  display: flex;
  align-items: center;
  justify-content: center;
}

.btm-nav {
  position: fixed;
  bottom: 0px;
  left: 0px;
  right: 0px;
  display: flex;
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: space-around;
  padding-bottom: env(safe-area-inset-bottom);
  height: 4rem;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
  color: currentColor;
}

.btm-nav > * {
  position: relative;
  display: flex;
  height: 100%;
  flex-basis: 100%;
  cursor: pointer;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  border-color: currentColor;
}

@media (hover:hover) {
  .checkbox-primary:hover {
    --tw-border-opacity: 1;
    border-color: var(--fallback-p,oklch(var(--p)/var(--tw-border-opacity)));
  }

  .label a:hover {
    --tw-text-opacity: 1;
    color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
  }

  .menu li > *:not(ul, .menu-title, details, .btn):active,
.menu li > *:not(ul, .menu-title, details, .btn).active,
.menu li > details > summary:active {
    --tw-bg-opacity: 1;
    background-color: var(--fallback-n,oklch(var(--n)/var(--tw-bg-opacity)));
    --tw-text-opacity: 1;
    color: var(--fallback-nc,oklch(var(--nc)/var(--tw-text-opacity)));
  }

  .table tr.hover:hover,
  .table tr.hover:nth-child(even):hover {
    --tw-bg-opacity: 1;
    background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
  }
}

.btn {
  display: inline-flex;
  height: 3rem;
  min-height: 3rem;
  flex-shrink: 0;
  cursor: pointer;
  -webkit-user-select: none;
     -moz-user-select: none;
          user-select: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  border-radius: var(--rounded-btn, 0.5rem);
  border-color: transparent;
  border-color: oklch(var(--btn-color, var(--b2)) / var(--tw-border-opacity));
  padding-left: 1rem;
  padding-right: 1rem;
  text-align: center;
  font-size: 0.875rem;
  line-height: 1em;
  gap: 0.5rem;
  font-weight: 600;
  text-decoration-line: none;
  transition-duration: 200ms;
  transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
  border-width: var(--border-btn, 1px);
  transition-property: color, background-color, border-color, opacity, box-shadow, transform;
  --tw-text-opacity: 1;
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
  --tw-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --tw-shadow-colored: 0 1px 2px 0 var(--tw-shadow-color);
  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
  outline-color: var(--fallback-bc,oklch(var(--bc)/1));
  background-color: oklch(var(--btn-color, var(--b2)) / var(--tw-bg-opacity));
  --tw-bg-opacity: 1;
  --tw-border-opacity: 1;
}

.btn-disabled,
  .btn[disabled],
  .btn:disabled {
  pointer-events: none;
}

.btn-square {
  height: 3rem;
  width: 3rem;
  padding: 0px;
}

:where(.btn:is(input[type="checkbox"])),
:where(.btn:is(input[type="radio"])) {
  width: auto;
  -webkit-appearance: none;
     -moz-appearance: none;
          appearance: none;
}

.btn:is(input[type="checkbox"]):after,
.btn:is(input[type="radio"]):after {
  --tw-content: attr(aria-label);
  content: var(--tw-content);
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  border-radius: var(--rounded-box, 1rem);
}

.card:focus {
  outline: 2px solid transparent;
  outline-offset: 2px;
}

.card-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  padding: var(--padding-card, 2rem);
  gap: 0.5rem;
}

.card-body :where(p) {
  flex-grow: 1;
}

.card figure {
  display: flex;
  align-items: center;
  justify-content: center;
}

.card.image-full {
  display: grid;
}

.card.image-full:before {
  position: relative;
  content: "";
  z-index: 10;
  border-radius: var(--rounded-box, 1rem);
  --tw-bg-opacity: 1;
  background-color: var(--fallback-n,oklch(var(--n)/var(--tw-bg-opacity)));
  opacity: 0.75;
}

.card.image-full:before,
    .card.image-full > * {
  grid-column-start: 1;
  grid-row-start: 1;
}

.card.image-full > figure img {
  height: 100%;
  -o-object-fit: cover;
     object-fit: cover;
}

.card.image-full > .card-body {
  position: relative;
  z-index: 20;
  --tw-text-opacity: 1;
  color: var(--fallback-nc,oklch(var(--nc)/var(--tw-text-opacity)));
}

.checkbox {
  flex-shrink: 0;
  --chkbg: var(--fallback-bc,oklch(var(--bc)/1));
  --chkfg: var(--fallback-b1,oklch(var(--b1)/1));
  height: 1.5rem;
  width: 1.5rem;
  cursor: pointer;
  -webkit-appearance: none;
     -moz-appearance: none;
          appearance: none;
  border-radius: var(--rounded-btn, 0.5rem);
  border-width: 1px;
  border-color: var(--fallback-bc,oklch(var(--bc)/var(--tw-border-opacity)));
  --tw-border-opacity: 0.2;
}

.diff {
  position: relative;
  display: grid;
  width: 100%;
  overflow: hidden;
  container-type: inline-size;
  grid-template-columns: auto 1fr;
}

.divider {
  display: flex;
  flex-direction: row;
  align-items: center;
  align-self: stretch;
  margin-top: 1rem;
  margin-bottom: 1rem;
  height: 1rem;
  white-space: nowrap;
}

.divider:before,
  .divider:after {
  height: 0.125rem;
  width: 100%;
  flex-grow: 1;
  --tw-content: '';
  content: var(--tw-content);
  background-color: var(--fallback-bc,oklch(var(--bc)/0.1));
}

.dropdown {
  position: relative;
  display: inline-block;
}

.dropdown > *:not(summary):focus {
  outline: 2px solid transparent;
  outline-offset: 2px;
}

.dropdown .dropdown-content {
  position: absolute;
}

.dropdown:is(:not(details)) .dropdown-content {
  visibility: hidden;
  opacity: 0;
  transform-origin: top;
  --tw-scale-x: .95;
  --tw-scale-y: .95;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, -webkit-backdrop-filter;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter, -webkit-backdrop-filter;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
  transition-duration: 200ms;
}

.dropdown-end .dropdown-content {
  inset-inline-end: 0px;
}

.dropdown-left .dropdown-content {
  bottom: auto;
  inset-inline-end: 100%;
  top: 0px;
  transform-origin: right;
}

.dropdown-right .dropdown-content {
  bottom: auto;
  inset-inline-start: 100%;
  top: 0px;
  transform-origin: left;
}

.dropdown-bottom .dropdown-content {
  bottom: auto;
  top: 100%;
  transform-origin: top;
}

.dropdown-top .dropdown-content {
  bottom: 100%;
  top: auto;
  transform-origin: bottom;
}

.dropdown-end.dropdown-right .dropdown-content {
  bottom: 0px;
  top: auto;
}

.dropdown-end.dropdown-left .dropdown-content {
  bottom: 0px;
  top: auto;
}

.dropdown.dropdown-open .dropdown-content,
.dropdown:not(.dropdown-hover):focus .dropdown-content,
.dropdown:focus-within .dropdown-content {
  visibility: visible;
  opacity: 1;
}

@media (hover: hover) {
  .dropdown.dropdown-hover:hover .dropdown-content {
    visibility: visible;
    opacity: 1;
  }

  .btm-nav > *.disabled:hover,
      .btm-nav > *[disabled]:hover {
    pointer-events: none;
    --tw-border-opacity: 0;
    background-color: var(--fallback-n,oklch(var(--n)/var(--tw-bg-opacity)));
    --tw-bg-opacity: 0.1;
    color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
    --tw-text-opacity: 0.2;
  }

  .btn:hover {
    --tw-border-opacity: 1;
    border-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-border-opacity)));
    --tw-bg-opacity: 1;
    background-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-bg-opacity)));
  }

  @supports (color: color-mix(in oklab, black, black)) {
    .btn:hover {
      background-color: color-mix(
            in oklab,
            oklch(var(--btn-color, var(--b2)) / var(--tw-bg-opacity, 1)) 90%,
            black
          );
      border-color: color-mix(
            in oklab,
            oklch(var(--btn-color, var(--b2)) / var(--tw-border-opacity, 1)) 90%,
            black
          );
    }
  }

  @supports not (color: oklch(0% 0 0)) {
    .btn:hover {
      background-color: var(--btn-color, var(--fallback-b2));
      border-color: var(--btn-color, var(--fallback-b2));
    }
  }

  .btn.glass:hover {
    --glass-opacity: 25%;
    --glass-border-opacity: 15%;
  }

  .btn-ghost:hover {
    border-color: transparent;
  }

  @supports (color: oklch(0% 0 0)) {
    .btn-ghost:hover {
      background-color: var(--fallback-bc,oklch(var(--bc)/0.2));
    }
  }

  .btn-outline:hover {
    --tw-border-opacity: 1;
    border-color: var(--fallback-bc,oklch(var(--bc)/var(--tw-border-opacity)));
    --tw-bg-opacity: 1;
    background-color: var(--fallback-bc,oklch(var(--bc)/var(--tw-bg-opacity)));
    --tw-text-opacity: 1;
    color: var(--fallback-b1,oklch(var(--b1)/var(--tw-text-opacity)));
  }

  .btn-outline.btn-primary:hover {
    --tw-text-opacity: 1;
    color: var(--fallback-pc,oklch(var(--pc)/var(--tw-text-opacity)));
  }

  @supports (color: color-mix(in oklab, black, black)) {
    .btn-outline.btn-primary:hover {
      background-color: color-mix(in oklab, var(--fallback-p,oklch(var(--p)/1)) 90%, black);
      border-color: color-mix(in oklab, var(--fallback-p,oklch(var(--p)/1)) 90%, black);
    }
  }

  .btn-outline.btn-secondary:hover {
    --tw-text-opacity: 1;
    color: var(--fallback-sc,oklch(var(--sc)/var(--tw-text-opacity)));
  }

  @supports (color: color-mix(in oklab, black, black)) {
    .btn-outline.btn-secondary:hover {
      background-color: color-mix(in oklab, var(--fallback-s,oklch(var(--s)/1)) 90%, black);
      border-color: color-mix(in oklab, var(--fallback-s,oklch(var(--s)/1)) 90%, black);
    }
  }

  .btn-outline.btn-accent:hover {
    --tw-text-opacity: 1;
    color: var(--fallback-ac,oklch(var(--ac)/var(--tw-text-opacity)));
  }

  @supports (color: color-mix(in oklab, black, black)) {
    .btn-outline.btn-accent:hover {
      background-color: color-mix(in oklab, var(--fallback-a,oklch(var(--a)/1)) 90%, black);
      border-color: color-mix(in oklab, var(--fallback-a,oklch(var(--a)/1)) 90%, black);
    }
  }

  .btn-outline.btn-success:hover {
    --tw-text-opacity: 1;
    color: var(--fallback-suc,oklch(var(--suc)/var(--tw-text-opacity)));
  }

  @supports (color: color-mix(in oklab, black, black)) {
    .btn-outline.btn-success:hover {
      background-color: color-mix(in oklab, var(--fallback-su,oklch(var(--su)/1)) 90%, black);
      border-color: color-mix(in oklab, var(--fallback-su,oklch(var(--su)/1)) 90%, black);
    }
  }

  .btn-outline.btn-info:hover {
    --tw-text-opacity: 1;
    color: var(--fallback-inc,oklch(var(--inc)/var(--tw-text-opacity)));
  }

  @supports (color: color-mix(in oklab, black, black)) {
    .btn-outline.btn-info:hover {
      background-color: color-mix(in oklab, var(--fallback-in,oklch(var(--in)/1)) 90%, black);
      border-color: color-mix(in oklab, var(--fallback-in,oklch(var(--in)/1)) 90%, black);
    }
  }

  .btn-outline.btn-warning:hover {
    --tw-text-opacity: 1;
    color: var(--fallback-wac,oklch(var(--wac)/var(--tw-text-opacity)));
  }

  @supports (color: color-mix(in oklab, black, black)) {
    .btn-outline.btn-warning:hover {
      background-color: color-mix(in oklab, var(--fallback-wa,oklch(var(--wa)/1)) 90%, black);
      border-color: color-mix(in oklab, var(--fallback-wa,oklch(var(--wa)/1)) 90%, black);
    }
  }

  .btn-outline.btn-error:hover {
    --tw-text-opacity: 1;
    color: var(--fallback-erc,oklch(var(--erc)/var(--tw-text-opacity)));
  }

  @supports (color: color-mix(in oklab, black, black)) {
    .btn-outline.btn-error:hover {
      background-color: color-mix(in oklab, var(--fallback-er,oklch(var(--er)/1)) 90%, black);
      border-color: color-mix(in oklab, var(--fallback-er,oklch(var(--er)/1)) 90%, black);
    }
  }

  .btn-disabled:hover,
    .btn[disabled]:hover,
    .btn:disabled:hover {
    --tw-border-opacity: 0;
    background-color: var(--fallback-n,oklch(var(--n)/var(--tw-bg-opacity)));
    --tw-bg-opacity: 0.2;
    color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
    --tw-text-opacity: 0.2;
  }

  @supports (color: color-mix(in oklab, black, black)) {
    .btn:is(input[type="checkbox"]:checked):hover, .btn:is(input[type="radio"]:checked):hover {
      background-color: color-mix(in oklab, var(--fallback-p,oklch(var(--p)/1)) 90%, black);
      border-color: color-mix(in oklab, var(--fallback-p,oklch(var(--p)/1)) 90%, black);
    }
  }

  .dropdown.dropdown-hover:hover .dropdown-content {
    --tw-scale-x: 1;
    --tw-scale-y: 1;
    transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
  }

  :where(.menu li:not(.menu-title, .disabled) > *:not(ul, details, .menu-title)):not(.active, .btn):hover, :where(.menu li:not(.menu-title, .disabled) > details > summary:not(.menu-title)):not(.active, .btn):hover {
    cursor: pointer;
    outline: 2px solid transparent;
    outline-offset: 2px;
  }

  @supports (color: oklch(0% 0 0)) {
    :where(.menu li:not(.menu-title, .disabled) > *:not(ul, details, .menu-title)):not(.active, .btn):hover, :where(.menu li:not(.menu-title, .disabled) > details > summary:not(.menu-title)):not(.active, .btn):hover {
      background-color: var(--fallback-bc,oklch(var(--bc)/0.1));
    }
  }
}

.dropdown:is(details) summary::-webkit-details-marker {
  display: none;
}

.form-control {
  display: flex;
  flex-direction: column;
}

.label {
  display: flex;
  -webkit-user-select: none;
     -moz-user-select: none;
          user-select: none;
  align-items: center;
  justify-content: space-between;
  padding-left: 0.25rem;
  padding-right: 0.25rem;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
}

.input {
  flex-shrink: 1;
  -webkit-appearance: none;
     -moz-appearance: none;
          appearance: none;
  height: 3rem;
  padding-left: 1rem;
  padding-right: 1rem;
  font-size: 1rem;
  line-height: 2;
  line-height: 1.5rem;
  border-radius: var(--rounded-btn, 0.5rem);
  border-width: 1px;
  border-color: transparent;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
}

.input[type="number"]::-webkit-inner-spin-button,
.input-md[type="number"]::-webkit-inner-spin-button {
  margin-top: -1rem;
  margin-bottom: -1rem;
  margin-inline-end: -1rem;
}

.join {
  display: inline-flex;
  align-items: stretch;
  border-radius: var(--rounded-btn, 0.5rem);
}

.join :where(.join-item) {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
  border-end-start-radius: 0;
  border-start-start-radius: 0;
}

.join .join-item:not(:first-child):not(:last-child),
  .join *:not(:first-child):not(:last-child) .join-item {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
  border-end-start-radius: 0;
  border-start-start-radius: 0;
}

.join .join-item:first-child:not(:last-child),
  .join *:first-child:not(:last-child) .join-item {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}

.join .dropdown .join-item:first-child:not(:last-child),
  .join *:first-child:not(:last-child) .dropdown .join-item {
  border-start-end-radius: inherit;
  border-end-end-radius: inherit;
}

.join :where(.join-item:first-child:not(:last-child)),
  .join :where(*:first-child:not(:last-child) .join-item) {
  border-end-start-radius: inherit;
  border-start-start-radius: inherit;
}

.join .join-item:last-child:not(:first-child),
  .join *:last-child:not(:first-child) .join-item {
  border-end-start-radius: 0;
  border-start-start-radius: 0;
}

.join :where(.join-item:last-child:not(:first-child)),
  .join :where(*:last-child:not(:first-child) .join-item) {
  border-start-end-radius: inherit;
  border-end-end-radius: inherit;
}

@supports not selector(:has(*)) {
  :where(.join *) {
    border-radius: inherit;
  }
}

@supports selector(:has(*)) {
  :where(.join *:has(.join-item)) {
    border-radius: inherit;
  }
}

.link {
  cursor: pointer;
  text-decoration-line: underline;
}

.menu {
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  font-size: 0.875rem;
  line-height: 1.25rem;
  padding: 0.5rem;
}

.menu :where(li ul) {
  position: relative;
  white-space: nowrap;
  margin-inline-start: 1rem;
  padding-inline-start: 0.5rem;
}

.menu :where(li:not(.menu-title) > *:not(ul, details, .menu-title, .btn)), .menu :where(li:not(.menu-title) > details > summary:not(.menu-title)) {
  display: grid;
  grid-auto-flow: column;
  align-content: flex-start;
  align-items: center;
  gap: 0.5rem;
  grid-auto-columns: minmax(auto, max-content) auto max-content;
  -webkit-user-select: none;
     -moz-user-select: none;
          user-select: none;
}

.menu li.disabled {
  cursor: not-allowed;
  -webkit-user-select: none;
     -moz-user-select: none;
          user-select: none;
  color: var(--fallback-bc,oklch(var(--bc)/0.3));
}

.menu :where(li > .menu-dropdown:not(.menu-dropdown-show)) {
  display: none;
}

:where(.menu li) {
  position: relative;
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  flex-wrap: wrap;
  align-items: stretch;
}

:where(.menu li) .badge {
  justify-self: end;
}

.modal {
  pointer-events: none;
  position: fixed;
  inset: 0px;
  margin: 0px;
  display: grid;
  height: 100%;
  max-height: none;
  width: 100%;
  max-width: none;
  justify-items: center;
  padding: 0px;
  opacity: 0;
  overscroll-behavior: contain;
  z-index: 999;
  background-color: transparent;
  color: inherit;
  transition-duration: 200ms;
  transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
  transition-property: transform, opacity, visibility;
  overflow-y: hidden;
}

:where(.modal) {
  align-items: center;
}

.modal-box {
  max-height: calc(100vh - 5em);
  grid-column-start: 1;
  grid-row-start: 1;
  width: 91.666667%;
  max-width: 32rem;
  --tw-scale-x: .9;
  --tw-scale-y: .9;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
  border-bottom-right-radius: var(--rounded-box, 1rem);
  border-bottom-left-radius: var(--rounded-box, 1rem);
  border-top-left-radius: var(--rounded-box, 1rem);
  border-top-right-radius: var(--rounded-box, 1rem);
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
  padding: 1.5rem;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, -webkit-backdrop-filter;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter, -webkit-backdrop-filter;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
  transition-duration: 200ms;
  box-shadow: rgba(0, 0, 0, 0.25) 0px 25px 50px -12px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.modal-open,
.modal:target,
.modal-toggle:checked + .modal,
.modal[open] {
  pointer-events: auto;
  visibility: visible;
  opacity: 1;
}

.modal-action {
  display: flex;
  margin-top: 1.5rem;
  justify-content: flex-end;
}

:root:has(:is(.modal-open, .modal:target, .modal-toggle:checked + .modal, .modal[open])) {
  overflow: hidden;
  scrollbar-gutter: stable;
}

.select {
  display: inline-flex;
  cursor: pointer;
  -webkit-user-select: none;
     -moz-user-select: none;
          user-select: none;
  -webkit-appearance: none;
     -moz-appearance: none;
          appearance: none;
  height: 3rem;
  min-height: 3rem;
  padding-inline-start: 1rem;
  padding-inline-end: 2.5rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  line-height: 2;
  border-radius: var(--rounded-btn, 0.5rem);
  border-width: 1px;
  border-color: transparent;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 20px) calc(1px + 50%),
    calc(100% - 16.1px) calc(1px + 50%);
  background-size: 4px 4px,
    4px 4px;
  background-repeat: no-repeat;
}

.select[multiple] {
  height: auto;
}

.table {
  position: relative;
  width: 100%;
  border-radius: var(--rounded-box, 1rem);
  text-align: left;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.table :where(.table-pin-rows thead tr) {
  position: sticky;
  top: 0px;
  z-index: 1;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
}

.table :where(.table-pin-rows tfoot tr) {
  position: sticky;
  bottom: 0px;
  z-index: 1;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
}

.table :where(.table-pin-cols tr th) {
  position: sticky;
  left: 0px;
  right: 0px;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
}

.textarea {
  min-height: 3rem;
  flex-shrink: 1;
  padding-left: 1rem;
  padding-right: 1rem;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  line-height: 2;
  border-radius: var(--rounded-btn, 0.5rem);
  border-width: 1px;
  border-color: transparent;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
}

.btm-nav > *:not(.active) {
  padding-top: 0.125rem;
}

.btm-nav > *:where(.active) {
  border-top-width: 2px;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
}

.btm-nav > *.disabled,
    .btm-nav > *[disabled] {
  pointer-events: none;
  --tw-border-opacity: 0;
  background-color: var(--fallback-n,oklch(var(--n)/var(--tw-bg-opacity)));
  --tw-bg-opacity: 0.1;
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
  --tw-text-opacity: 0.2;
}

.btm-nav > * .label {
  font-size: 1rem;
  line-height: 1.5rem;
}

@media (prefers-reduced-motion: no-preference) {
  .btn {
    animation: button-pop var(--animation-btn, 0.25s) ease-out;
  }
}

.btn:active:hover,
  .btn:active:focus {
  animation: button-pop 0s ease-out;
  transform: scale(var(--btn-focus-scale, 0.97));
}

@supports not (color: oklch(0% 0 0)) {
  .btn {
    background-color: var(--btn-color, var(--fallback-b2));
    border-color: var(--btn-color, var(--fallback-b2));
  }

  .btn-primary {
    --btn-color: var(--fallback-p);
  }

  .btn-secondary {
    --btn-color: var(--fallback-s);
  }

  .btn-accent {
    --btn-color: var(--fallback-a);
  }

  .btn-error {
    --btn-color: var(--fallback-er);
  }
}

@supports (color: color-mix(in oklab, black, black)) {
  .btn-outline.btn-primary.btn-active {
    background-color: color-mix(in oklab, var(--fallback-p,oklch(var(--p)/1)) 90%, black);
    border-color: color-mix(in oklab, var(--fallback-p,oklch(var(--p)/1)) 90%, black);
  }

  .btn-outline.btn-secondary.btn-active {
    background-color: color-mix(in oklab, var(--fallback-s,oklch(var(--s)/1)) 90%, black);
    border-color: color-mix(in oklab, var(--fallback-s,oklch(var(--s)/1)) 90%, black);
  }

  .btn-outline.btn-accent.btn-active {
    background-color: color-mix(in oklab, var(--fallback-a,oklch(var(--a)/1)) 90%, black);
    border-color: color-mix(in oklab, var(--fallback-a,oklch(var(--a)/1)) 90%, black);
  }

  .btn-outline.btn-success.btn-active {
    background-color: color-mix(in oklab, var(--fallback-su,oklch(var(--su)/1)) 90%, black);
    border-color: color-mix(in oklab, var(--fallback-su,oklch(var(--su)/1)) 90%, black);
  }

  .btn-outline.btn-info.btn-active {
    background-color: color-mix(in oklab, var(--fallback-in,oklch(var(--in)/1)) 90%, black);
    border-color: color-mix(in oklab, var(--fallback-in,oklch(var(--in)/1)) 90%, black);
  }

  .btn-outline.btn-warning.btn-active {
    background-color: color-mix(in oklab, var(--fallback-wa,oklch(var(--wa)/1)) 90%, black);
    border-color: color-mix(in oklab, var(--fallback-wa,oklch(var(--wa)/1)) 90%, black);
  }

  .btn-outline.btn-error.btn-active {
    background-color: color-mix(in oklab, var(--fallback-er,oklch(var(--er)/1)) 90%, black);
    border-color: color-mix(in oklab, var(--fallback-er,oklch(var(--er)/1)) 90%, black);
  }
}

.btn:focus-visible {
  outline-style: solid;
  outline-width: 2px;
  outline-offset: 2px;
}

.btn-primary {
  --tw-text-opacity: 1;
  color: var(--fallback-pc,oklch(var(--pc)/var(--tw-text-opacity)));
  outline-color: var(--fallback-p,oklch(var(--p)/1));
}

@supports (color: oklch(0% 0 0)) {
  .btn-primary {
    --btn-color: var(--p);
  }

  .btn-secondary {
    --btn-color: var(--s);
  }

  .btn-accent {
    --btn-color: var(--a);
  }

  .btn-error {
    --btn-color: var(--er);
  }
}

.btn-secondary {
  --tw-text-opacity: 1;
  color: var(--fallback-sc,oklch(var(--sc)/var(--tw-text-opacity)));
  outline-color: var(--fallback-s,oklch(var(--s)/1));
}

.btn-accent {
  --tw-text-opacity: 1;
  color: var(--fallback-ac,oklch(var(--ac)/var(--tw-text-opacity)));
  outline-color: var(--fallback-a,oklch(var(--a)/1));
}

.btn-error {
  --tw-text-opacity: 1;
  color: var(--fallback-erc,oklch(var(--erc)/var(--tw-text-opacity)));
  outline-color: var(--fallback-er,oklch(var(--er)/1));
}

.btn.glass {
  --tw-shadow: 0 0 #0000;
  --tw-shadow-colored: 0 0 #0000;
  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
  outline-color: currentColor;
}

.btn.glass.btn-active {
  --glass-opacity: 25%;
  --glass-border-opacity: 15%;
}

.btn-ghost {
  border-width: 1px;
  border-color: transparent;
  background-color: transparent;
  color: currentColor;
  --tw-shadow: 0 0 #0000;
  --tw-shadow-colored: 0 0 #0000;
  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
  outline-color: currentColor;
}

.btn-ghost.btn-active {
  border-color: transparent;
  background-color: var(--fallback-bc,oklch(var(--bc)/0.2));
}

.btn-outline {
  border-color: currentColor;
  background-color: transparent;
  --tw-text-opacity: 1;
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
  --tw-shadow: 0 0 #0000;
  --tw-shadow-colored: 0 0 #0000;
  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
}

.btn-outline.btn-active {
  --tw-border-opacity: 1;
  border-color: var(--fallback-bc,oklch(var(--bc)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-bc,oklch(var(--bc)/var(--tw-bg-opacity)));
  --tw-text-opacity: 1;
  color: var(--fallback-b1,oklch(var(--b1)/var(--tw-text-opacity)));
}

.btn-outline.btn-primary {
  --tw-text-opacity: 1;
  color: var(--fallback-p,oklch(var(--p)/var(--tw-text-opacity)));
}

.btn-outline.btn-primary.btn-active {
  --tw-text-opacity: 1;
  color: var(--fallback-pc,oklch(var(--pc)/var(--tw-text-opacity)));
}

.btn-outline.btn-secondary {
  --tw-text-opacity: 1;
  color: var(--fallback-s,oklch(var(--s)/var(--tw-text-opacity)));
}

.btn-outline.btn-secondary.btn-active {
  --tw-text-opacity: 1;
  color: var(--fallback-sc,oklch(var(--sc)/var(--tw-text-opacity)));
}

.btn-outline.btn-accent {
  --tw-text-opacity: 1;
  color: var(--fallback-a,oklch(var(--a)/var(--tw-text-opacity)));
}

.btn-outline.btn-accent.btn-active {
  --tw-text-opacity: 1;
  color: var(--fallback-ac,oklch(var(--ac)/var(--tw-text-opacity)));
}

.btn-outline.btn-success {
  --tw-text-opacity: 1;
  color: var(--fallback-su,oklch(var(--su)/var(--tw-text-opacity)));
}

.btn-outline.btn-success.btn-active {
  --tw-text-opacity: 1;
  color: var(--fallback-suc,oklch(var(--suc)/var(--tw-text-opacity)));
}

.btn-outline.btn-info {
  --tw-text-opacity: 1;
  color: var(--fallback-in,oklch(var(--in)/var(--tw-text-opacity)));
}

.btn-outline.btn-info.btn-active {
  --tw-text-opacity: 1;
  color: var(--fallback-inc,oklch(var(--inc)/var(--tw-text-opacity)));
}

.btn-outline.btn-warning {
  --tw-text-opacity: 1;
  color: var(--fallback-wa,oklch(var(--wa)/var(--tw-text-opacity)));
}

.btn-outline.btn-warning.btn-active {
  --tw-text-opacity: 1;
  color: var(--fallback-wac,oklch(var(--wac)/var(--tw-text-opacity)));
}

.btn-outline.btn-error {
  --tw-text-opacity: 1;
  color: var(--fallback-er,oklch(var(--er)/var(--tw-text-opacity)));
}

.btn-outline.btn-error.btn-active {
  --tw-text-opacity: 1;
  color: var(--fallback-erc,oklch(var(--erc)/var(--tw-text-opacity)));
}

.btn.btn-disabled,
  .btn[disabled],
  .btn:disabled {
  --tw-border-opacity: 0;
  background-color: var(--fallback-n,oklch(var(--n)/var(--tw-bg-opacity)));
  --tw-bg-opacity: 0.2;
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
  --tw-text-opacity: 0.2;
}

.btn:is(input[type="checkbox"]:checked),
.btn:is(input[type="radio"]:checked) {
  --tw-border-opacity: 1;
  border-color: var(--fallback-p,oklch(var(--p)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-p,oklch(var(--p)/var(--tw-bg-opacity)));
  --tw-text-opacity: 1;
  color: var(--fallback-pc,oklch(var(--pc)/var(--tw-text-opacity)));
}

.btn:is(input[type="checkbox"]:checked):focus-visible, .btn:is(input[type="radio"]:checked):focus-visible {
  outline-color: var(--fallback-p,oklch(var(--p)/1));
}

@keyframes button-pop {
  0% {
    transform: scale(var(--btn-focus-scale, 0.98));
  }

  40% {
    transform: scale(1.02);
  }

  100% {
    transform: scale(1);
  }
}

.card :where(figure:first-child) {
  overflow: hidden;
  border-start-start-radius: inherit;
  border-start-end-radius: inherit;
  border-end-start-radius: unset;
  border-end-end-radius: unset;
}

.card :where(figure:last-child) {
  overflow: hidden;
  border-start-start-radius: unset;
  border-start-end-radius: unset;
  border-end-start-radius: inherit;
  border-end-end-radius: inherit;
}

.card:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.card.bordered {
  border-width: 1px;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-border-opacity)));
}

.card.compact .card-body {
  padding: 1rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.25rem;
  line-height: 1.75rem;
  font-weight: 600;
}

.card.image-full :where(figure) {
  overflow: hidden;
  border-radius: inherit;
}

.checkbox:focus {
  box-shadow: none;
}

.checkbox:focus-visible {
  outline-style: solid;
  outline-width: 2px;
  outline-offset: 2px;
  outline-color: var(--fallback-bc,oklch(var(--bc)/1));
}

.checkbox:disabled {
  border-width: 0px;
  cursor: not-allowed;
  border-color: transparent;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-bc,oklch(var(--bc)/var(--tw-bg-opacity)));
  opacity: 0.2;
}

.checkbox:checked,
  .checkbox[aria-checked="true"] {
  background-repeat: no-repeat;
  animation: checkmark var(--animation-input, 0.2s) ease-out;
  background-color: var(--chkbg);
  background-image: linear-gradient(-45deg, transparent 65%, var(--chkbg) 65.99%),
      linear-gradient(45deg, transparent 75%, var(--chkbg) 75.99%),
      linear-gradient(-45deg, var(--chkbg) 40%, transparent 40.99%),
      linear-gradient(
        45deg,
        var(--chkbg) 30%,
        var(--chkfg) 30.99%,
        var(--chkfg) 40%,
        transparent 40.99%
      ),
      linear-gradient(-45deg, var(--chkfg) 50%, var(--chkbg) 50.99%);
}

.checkbox:indeterminate {
  --tw-bg-opacity: 1;
  background-color: var(--fallback-bc,oklch(var(--bc)/var(--tw-bg-opacity)));
  background-repeat: no-repeat;
  animation: checkmark var(--animation-input, 0.2s) ease-out;
  background-image: linear-gradient(90deg, transparent 80%, var(--chkbg) 80%),
      linear-gradient(-90deg, transparent 80%, var(--chkbg) 80%),
      linear-gradient(0deg, var(--chkbg) 43%, var(--chkfg) 43%, var(--chkfg) 57%, var(--chkbg) 57%);
}

.checkbox-primary {
  --chkbg: var(--fallback-p,oklch(var(--p)/1));
  --chkfg: var(--fallback-pc,oklch(var(--pc)/1));
  --tw-border-opacity: 1;
  border-color: var(--fallback-p,oklch(var(--p)/var(--tw-border-opacity)));
}

.checkbox-primary:focus-visible {
  outline-color: var(--fallback-p,oklch(var(--p)/1));
}

.checkbox-primary:checked,
    .checkbox-primary[aria-checked="true"] {
  --tw-border-opacity: 1;
  border-color: var(--fallback-p,oklch(var(--p)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-p,oklch(var(--p)/var(--tw-bg-opacity)));
  --tw-text-opacity: 1;
  color: var(--fallback-pc,oklch(var(--pc)/var(--tw-text-opacity)));
}

@keyframes checkmark {
  0% {
    background-position-y: 5px;
  }

  50% {
    background-position-y: -2px;
  }

  100% {
    background-position-y: 0;
  }
}

.divider:not(:empty) {
  gap: 1rem;
}

.dropdown.dropdown-open .dropdown-content,
.dropdown:focus .dropdown-content,
.dropdown:focus-within .dropdown-content {
  --tw-scale-x: 1;
  --tw-scale-y: 1;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
}

.label-text {
  font-size: 0.875rem;
  line-height: 1.25rem;
  --tw-text-opacity: 1;
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
}

.input input {
  --tw-bg-opacity: 1;
  background-color: var(--fallback-p,oklch(var(--p)/var(--tw-bg-opacity)));
  background-color: transparent;
}

.input input:focus {
  outline: 2px solid transparent;
  outline-offset: 2px;
}

.input[list]::-webkit-calendar-picker-indicator {
  line-height: 1em;
}

.input-bordered {
  border-color: var(--fallback-bc,oklch(var(--bc)/0.2));
}

.input:focus,
  .input:focus-within {
  box-shadow: none;
  border-color: var(--fallback-bc,oklch(var(--bc)/0.2));
  outline-style: solid;
  outline-width: 2px;
  outline-offset: 2px;
  outline-color: var(--fallback-bc,oklch(var(--bc)/0.2));
}

.input:has(> input[disabled]),
  .input-disabled,
  .input:disabled,
  .input[disabled] {
  cursor: not-allowed;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
  color: var(--fallback-bc,oklch(var(--bc)/0.4));
}

.input:has(> input[disabled])::-moz-placeholder, .input-disabled::-moz-placeholder, .input:disabled::-moz-placeholder, .input[disabled]::-moz-placeholder {
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-placeholder-opacity)));
  --tw-placeholder-opacity: 0.2;
}

.input:has(> input[disabled])::placeholder,
  .input-disabled::placeholder,
  .input:disabled::placeholder,
  .input[disabled]::placeholder {
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-placeholder-opacity)));
  --tw-placeholder-opacity: 0.2;
}

.input:has(> input[disabled]) > input[disabled] {
  cursor: not-allowed;
}

.input::-webkit-date-and-time-value {
  text-align: inherit;
}

.join > :where(*:not(:first-child)) {
  margin-top: 0px;
  margin-bottom: 0px;
  margin-inline-start: -1px;
}

.join > :where(*:not(:first-child)):is(.btn) {
  margin-inline-start: calc(var(--border-btn) * -1);
}

.link:focus {
  outline: 2px solid transparent;
  outline-offset: 2px;
}

.link:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.loading {
  pointer-events: none;
  display: inline-block;
  aspect-ratio: 1 / 1;
  width: 1.5rem;
  background-color: currentColor;
  -webkit-mask-size: 100%;
          mask-size: 100%;
  -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
  -webkit-mask-position: center;
          mask-position: center;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='%23000' viewBox='0 0 24 24' xmlns='http:
          mask-image: url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='%23000' viewBox='0 0 24 24' xmlns='http:
}

:where(.menu li:empty) {
  --tw-bg-opacity: 1;
  background-color: var(--fallback-bc,oklch(var(--bc)/var(--tw-bg-opacity)));
  opacity: 0.1;
  margin: 0.5rem 1rem;
  height: 1px;
}

.menu :where(li ul):before {
  position: absolute;
  bottom: 0.75rem;
  inset-inline-start: 0px;
  top: 0.75rem;
  width: 1px;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-bc,oklch(var(--bc)/var(--tw-bg-opacity)));
  opacity: 0.1;
  content: "";
}

.menu :where(li:not(.menu-title) > *:not(ul, details, .menu-title, .btn)),
.menu :where(li:not(.menu-title) > details > summary:not(.menu-title)) {
  border-radius: var(--rounded-btn, 0.5rem);
  padding-left: 1rem;
  padding-right: 1rem;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  text-align: start;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, -webkit-backdrop-filter;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter, -webkit-backdrop-filter;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
  transition-duration: 200ms;
  text-wrap: balance;
}

:where(.menu li:not(.menu-title, .disabled) > *:not(ul, details, .menu-title)):not(summary, .active, .btn).focus, :where(.menu li:not(.menu-title, .disabled) > *:not(ul, details, .menu-title)):not(summary, .active, .btn):focus, :where(.menu li:not(.menu-title, .disabled) > *:not(ul, details, .menu-title)):is(summary):not(.active, .btn):focus-visible, :where(.menu li:not(.menu-title, .disabled) > details > summary:not(.menu-title)):not(summary, .active, .btn).focus, :where(.menu li:not(.menu-title, .disabled) > details > summary:not(.menu-title)):not(summary, .active, .btn):focus, :where(.menu li:not(.menu-title, .disabled) > details > summary:not(.menu-title)):is(summary):not(.active, .btn):focus-visible {
  cursor: pointer;
  background-color: var(--fallback-bc,oklch(var(--bc)/0.1));
  --tw-text-opacity: 1;
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
  outline: 2px solid transparent;
  outline-offset: 2px;
}

.menu li > *:not(ul, .menu-title, details, .btn):active,
.menu li > *:not(ul, .menu-title, details, .btn).active,
.menu li > details > summary:active {
  --tw-bg-opacity: 1;
  background-color: var(--fallback-n,oklch(var(--n)/var(--tw-bg-opacity)));
  --tw-text-opacity: 1;
  color: var(--fallback-nc,oklch(var(--nc)/var(--tw-text-opacity)));
}

.menu :where(li > details > summary)::-webkit-details-marker {
  display: none;
}

.menu :where(li > details > summary):after,
.menu :where(li > .menu-dropdown-toggle):after {
  justify-self: end;
  display: block;
  margin-top: -0.5rem;
  height: 0.5rem;
  width: 0.5rem;
  transform: rotate(45deg);
  transition-property: transform, margin-top;
  transition-duration: 0.3s;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  content: "";
  transform-origin: 75% 75%;
  box-shadow: 2px 2px;
  pointer-events: none;
}

.menu :where(li > details[open] > summary):after,
.menu :where(li > .menu-dropdown-toggle.menu-dropdown-show):after {
  transform: rotate(225deg);
  margin-top: 0;
}

.mockup-phone .display {
  overflow: hidden;
  border-radius: 40px;
  margin-top: -25px;
}

.mockup-browser .mockup-browser-toolbar .input {
  position: relative;
  margin-left: auto;
  margin-right: auto;
  display: block;
  height: 1.75rem;
  width: 24rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
  padding-left: 2rem;
  direction: ltr;
}

.mockup-browser .mockup-browser-toolbar .input:before {
  content: "";
  position: absolute;
  left: 0.5rem;
  top: 50%;
  aspect-ratio: 1 / 1;
  height: 0.75rem;
  --tw-translate-y: -50%;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
  border-radius: 9999px;
  border-width: 2px;
  border-color: currentColor;
  opacity: 0.6;
}

.mockup-browser .mockup-browser-toolbar .input:after {
  content: "";
  position: absolute;
  left: 1.25rem;
  top: 50%;
  height: 0.5rem;
  --tw-translate-y: 25%;
  --tw-rotate: -45deg;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
  border-radius: 9999px;
  border-width: 1px;
  border-color: currentColor;
  opacity: 0.6;
}

.modal:not(dialog:not(.modal-open)),
  .modal::backdrop {
  background-color: #0006;
  animation: modal-pop 0.2s ease-out;
}

.modal-open .modal-box,
.modal-toggle:checked + .modal .modal-box,
.modal:target .modal-box,
.modal[open] .modal-box {
  --tw-translate-y: 0px;
  --tw-scale-x: 1;
  --tw-scale-y: 1;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
}

.modal-action > :not([hidden]) ~ :not([hidden]) {
  --tw-space-x-reverse: 0;
  margin-right: calc(0.5rem * var(--tw-space-x-reverse));
  margin-left: calc(0.5rem * calc(1 - var(--tw-space-x-reverse)));
}

@keyframes modal-pop {
  0% {
    opacity: 0;
  }
}

@keyframes progress-loading {
  50% {
    background-position-x: -115%;
  }
}

@keyframes radiomark {
  0% {
    box-shadow: 0 0 0 12px var(--fallback-b1,oklch(var(--b1)/1)) inset,
      0 0 0 12px var(--fallback-b1,oklch(var(--b1)/1)) inset;
  }

  50% {
    box-shadow: 0 0 0 3px var(--fallback-b1,oklch(var(--b1)/1)) inset,
      0 0 0 3px var(--fallback-b1,oklch(var(--b1)/1)) inset;
  }

  100% {
    box-shadow: 0 0 0 4px var(--fallback-b1,oklch(var(--b1)/1)) inset,
      0 0 0 4px var(--fallback-b1,oklch(var(--b1)/1)) inset;
  }
}

@keyframes rating-pop {
  0% {
    transform: translateY(-0.125em);
  }

  40% {
    transform: translateY(-0.125em);
  }

  100% {
    transform: translateY(0);
  }
}

.select-bordered {
  border-color: var(--fallback-bc,oklch(var(--bc)/0.2));
}

.select:focus {
  box-shadow: none;
  border-color: var(--fallback-bc,oklch(var(--bc)/0.2));
  outline-style: solid;
  outline-width: 2px;
  outline-offset: 2px;
  outline-color: var(--fallback-bc,oklch(var(--bc)/0.2));
}

.select-disabled,
  .select:disabled,
  .select[disabled] {
  cursor: not-allowed;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
  color: var(--fallback-bc,oklch(var(--bc)/0.4));
}

.select-disabled::-moz-placeholder, .select:disabled::-moz-placeholder, .select[disabled]::-moz-placeholder {
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-placeholder-opacity)));
  --tw-placeholder-opacity: 0.2;
}

.select-disabled::placeholder,
  .select:disabled::placeholder,
  .select[disabled]::placeholder {
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-placeholder-opacity)));
  --tw-placeholder-opacity: 0.2;
}

.select-multiple,
  .select[multiple],
  .select[size].select:not([size="1"]) {
  background-image: none;
  padding-right: 1rem;
}

[dir="rtl"] .select {
  background-position: calc(0% + 12px) calc(1px + 50%),
    calc(0% + 16px) calc(1px + 50%);
}

@keyframes skeleton {
  from {
    background-position: 150%;
  }

  to {
    background-position: -50%;
  }
}

.table:where([dir="rtl"], [dir="rtl"] *) {
  text-align: right;
}

.table :where(th, td) {
  padding-left: 1rem;
  padding-right: 1rem;
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
  vertical-align: middle;
}

.table tr.active,
  .table tr.active:nth-child(even),
  .table-zebra tbody tr:nth-child(even) {
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
}

.table-zebra tr.active,
    .table-zebra tr.active:nth-child(even),
    .table-zebra-zebra tbody tr:nth-child(even) {
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-bg-opacity)));
}

.table :where(thead tr, tbody tr:not(:last-child), tbody tr:first-child:last-child) {
  border-bottom-width: 1px;
  --tw-border-opacity: 1;
  border-bottom-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-border-opacity)));
}

.table :where(thead, tfoot) {
  white-space: nowrap;
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: 700;
  color: var(--fallback-bc,oklch(var(--bc)/0.6));
}

.table :where(tfoot) {
  border-top-width: 1px;
  --tw-border-opacity: 1;
  border-top-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-border-opacity)));
}

.textarea-bordered {
  border-color: var(--fallback-bc,oklch(var(--bc)/0.2));
}

.textarea:focus {
  box-shadow: none;
  border-color: var(--fallback-bc,oklch(var(--bc)/0.2));
  outline-style: solid;
  outline-width: 2px;
  outline-offset: 2px;
  outline-color: var(--fallback-bc,oklch(var(--bc)/0.2));
}

.textarea-disabled,
  .textarea:disabled,
  .textarea[disabled] {
  cursor: not-allowed;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
  color: var(--fallback-bc,oklch(var(--bc)/0.4));
}

.textarea-disabled::-moz-placeholder, .textarea:disabled::-moz-placeholder, .textarea[disabled]::-moz-placeholder {
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-placeholder-opacity)));
  --tw-placeholder-opacity: 0.2;
}

.textarea-disabled::placeholder,
  .textarea:disabled::placeholder,
  .textarea[disabled]::placeholder {
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-placeholder-opacity)));
  --tw-placeholder-opacity: 0.2;
}

@keyframes toast-pop {
  0% {
    transform: scale(0.9);
    opacity: 0;
  }

  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.artboard.phone {
  width: 320px;
}

.btm-nav-xs > *:where(.active) {
  border-top-width: 1px;
}

.btm-nav-sm > *:where(.active) {
  border-top-width: 2px;
}

.btm-nav-md > *:where(.active) {
  border-top-width: 2px;
}

.btm-nav-lg > *:where(.active) {
  border-top-width: 4px;
}

.btn-xs {
  height: 1.5rem;
  min-height: 1.5rem;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
  font-size: 0.75rem;
}

.btn-sm {
  height: 2rem;
  min-height: 2rem;
  padding-left: 0.75rem;
  padding-right: 0.75rem;
  font-size: 0.875rem;
}

.btn-block {
  width: 100%;
}

.btn-square:where(.btn-xs) {
  height: 1.5rem;
  width: 1.5rem;
  padding: 0px;
}

.btn-square:where(.btn-sm) {
  height: 2rem;
  width: 2rem;
  padding: 0px;
}

.btn-square:where(.btn-md) {
  height: 3rem;
  width: 3rem;
  padding: 0px;
}

.btn-square:where(.btn-lg) {
  height: 4rem;
  width: 4rem;
  padding: 0px;
}

.btn-circle:where(.btn-xs) {
  height: 1.5rem;
  width: 1.5rem;
  border-radius: 9999px;
  padding: 0px;
}

.btn-circle:where(.btn-sm) {
  height: 2rem;
  width: 2rem;
  border-radius: 9999px;
  padding: 0px;
}

.join.join-vertical {
  flex-direction: column;
}

.join.join-vertical .join-item:first-child:not(:last-child),
  .join.join-vertical *:first-child:not(:last-child) .join-item {
  border-end-start-radius: 0;
  border-end-end-radius: 0;
  border-start-start-radius: inherit;
  border-start-end-radius: inherit;
}

.join.join-vertical .join-item:last-child:not(:first-child),
  .join.join-vertical *:last-child:not(:first-child) .join-item {
  border-start-start-radius: 0;
  border-start-end-radius: 0;
  border-end-start-radius: inherit;
  border-end-end-radius: inherit;
}

.join.join-horizontal {
  flex-direction: row;
}

.join.join-horizontal .join-item:first-child:not(:last-child),
  .join.join-horizontal *:first-child:not(:last-child) .join-item {
  border-end-end-radius: 0;
  border-start-end-radius: 0;
  border-end-start-radius: inherit;
  border-start-start-radius: inherit;
}

.join.join-horizontal .join-item:last-child:not(:first-child),
  .join.join-horizontal *:last-child:not(:first-child) .join-item {
  border-end-start-radius: 0;
  border-start-start-radius: 0;
  border-end-end-radius: inherit;
  border-start-end-radius: inherit;
}

.tooltip {
  position: relative;
  display: inline-block;
  --tooltip-offset: calc(100% + 1px + var(--tooltip-tail, 0px));
}

.tooltip:before {
  position: absolute;
  pointer-events: none;
  z-index: 1;
  content: var(--tw-content);
  --tw-content: attr(data-tip);
}

.tooltip:before, .tooltip-top:before {
  transform: translateX(-50%);
  top: auto;
  left: 50%;
  right: auto;
  bottom: var(--tooltip-offset);
}

.tooltip-left:before {
  transform: translateY(-50%);
  top: 50%;
  left: auto;
  right: var(--tooltip-offset);
  bottom: auto;
}

.card-compact .card-body {
  padding: 1rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.card-compact .card-title {
  margin-bottom: 0.25rem;
}

.card-normal .card-body {
  padding: var(--padding-card, 2rem);
  font-size: 1rem;
  line-height: 1.5rem;
}

.card-normal .card-title {
  margin-bottom: 0.75rem;
}

.join.join-vertical > :where(*:not(:first-child)) {
  margin-left: 0px;
  margin-right: 0px;
  margin-top: -1px;
}

.join.join-vertical > :where(*:not(:first-child)):is(.btn) {
  margin-top: calc(var(--border-btn) * -1);
}

.join.join-horizontal > :where(*:not(:first-child)) {
  margin-top: 0px;
  margin-bottom: 0px;
  margin-inline-start: -1px;
}

.join.join-horizontal > :where(*:not(:first-child)):is(.btn) {
  margin-inline-start: calc(var(--border-btn) * -1);
  margin-top: 0px;
}

.modal-top :where(.modal-box) {
  width: 100%;
  max-width: none;
  --tw-translate-y: -2.5rem;
  --tw-scale-x: 1;
  --tw-scale-y: 1;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
  border-bottom-right-radius: var(--rounded-box, 1rem);
  border-bottom-left-radius: var(--rounded-box, 1rem);
  border-top-left-radius: 0px;
  border-top-right-radius: 0px;
}

.modal-middle :where(.modal-box) {
  width: 91.666667%;
  max-width: 32rem;
  --tw-translate-y: 0px;
  --tw-scale-x: .9;
  --tw-scale-y: .9;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
  border-top-left-radius: var(--rounded-box, 1rem);
  border-top-right-radius: var(--rounded-box, 1rem);
  border-bottom-right-radius: var(--rounded-box, 1rem);
  border-bottom-left-radius: var(--rounded-box, 1rem);
}

.modal-bottom :where(.modal-box) {
  width: 100%;
  max-width: none;
  --tw-translate-y: 2.5rem;
  --tw-scale-x: 1;
  --tw-scale-y: 1;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
  border-top-left-radius: var(--rounded-box, 1rem);
  border-top-right-radius: var(--rounded-box, 1rem);
  border-bottom-right-radius: 0px;
  border-bottom-left-radius: 0px;
}

.tooltip {
  position: relative;
  display: inline-block;
  text-align: center;
  --tooltip-tail: 0.1875rem;
  --tooltip-color: var(--fallback-n,oklch(var(--n)/1));
  --tooltip-text-color: var(--fallback-nc,oklch(var(--nc)/1));
  --tooltip-tail-offset: calc(100% + 0.0625rem - var(--tooltip-tail));
}

.tooltip:before,
.tooltip:after {
  opacity: 0;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, -webkit-backdrop-filter;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter, -webkit-backdrop-filter;
  transition-delay: 100ms;
  transition-duration: 200ms;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

.tooltip:after {
  position: absolute;
  content: "";
  border-style: solid;
  border-width: var(--tooltip-tail, 0);
  width: 0;
  height: 0;
  display: block;
}

.tooltip:before {
  max-width: 20rem;
  white-space: normal;
  border-radius: 0.25rem;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
  padding-top: 0.25rem;
  padding-bottom: 0.25rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  background-color: var(--tooltip-color);
  color: var(--tooltip-text-color);
  width: -moz-max-content;
  width: max-content;
}

.tooltip.tooltip-open:before {
  opacity: 1;
  transition-delay: 75ms;
}

.tooltip.tooltip-open:after {
  opacity: 1;
  transition-delay: 75ms;
}

.tooltip:hover:before {
  opacity: 1;
  transition-delay: 75ms;
}

.tooltip:hover:after {
  opacity: 1;
  transition-delay: 75ms;
}

.tooltip:has(:focus-visible):after,
.tooltip:has(:focus-visible):before {
  opacity: 1;
  transition-delay: 75ms;
}

.tooltip:not([data-tip]):hover:before,
.tooltip:not([data-tip]):hover:after {
  visibility: hidden;
  opacity: 0;
}

.tooltip:after, .tooltip-top:after {
  transform: translateX(-50%);
  border-color: var(--tooltip-color) transparent transparent transparent;
  top: auto;
  left: 50%;
  right: auto;
  bottom: var(--tooltip-tail-offset);
}

.tooltip-left:after {
  transform: translateY(-50%);
  border-color: transparent transparent transparent var(--tooltip-color);
  top: 50%;
  left: auto;
  right: calc(var(--tooltip-tail-offset) + 0.0625rem);
  bottom: auto;
}



.card {
  border-width: 1px;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
  --tw-text-opacity: 1;
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
}



.form-control {
  position: relative;
}

.form-control > :not([hidden]) ~ :not([hidden]) {
  --tw-space-y-reverse: 0;
  margin-top: calc(0.25rem * calc(1 - var(--tw-space-y-reverse)));
  margin-bottom: calc(0.25rem * var(--tw-space-y-reverse));
}

.form-control .label {
  padding-bottom: 0.25rem;
}

.form-control .label-text {
  font-weight: 500;
  opacity: 0.7;
}

.input, .select, .textarea {
  --tw-border-opacity: 1;
  border-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 200ms;
}

.input:focus, .select:focus, .textarea:focus {
  --tw-border-opacity: 1;
  border-color: var(--fallback-p,oklch(var(--p)/var(--tw-border-opacity)));
  --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);
  --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);
  box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000);
  --tw-ring-color: var(--fallback-p,oklch(var(--p)/0.2));
}

.input:disabled, .select:disabled, .textarea:disabled {
  cursor: not-allowed;
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
}



.messages-container > :not([hidden]) ~ :not([hidden]) {
  --tw-space-y-reverse: 0;
  margin-top: calc(1rem * calc(1 - var(--tw-space-y-reverse)));
  margin-bottom: calc(1rem * var(--tw-space-y-reverse));
}

.sms {
  border-radius: 0.5rem;
  border-width: 1px;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
  padding: 1rem;
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 200ms;
}

.sms:hover {
  --tw-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --tw-shadow-colored: 0 4px 6px -1px var(--tw-shadow-color), 0 2px 4px -2px var(--tw-shadow-color);
  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
}



.contactCont {
  border-radius: 0.5rem;
  padding: 0.5rem;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}

.contactCont:hover {
  background-color: var(--fallback-b3,oklch(var(--b3)/0.5));
}



.btn {
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 200ms;
}

.btn:active {
  --tw-scale-x: .95;
  --tw-scale-y: .95;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
}



#aiResult > :not([hidden]) ~ :not([hidden]) {
  --tw-space-y-reverse: 0;
  margin-top: calc(1rem * calc(1 - var(--tw-space-y-reverse)));
  margin-bottom: calc(1rem * var(--tw-space-y-reverse));
}

#aiResult {
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
}

.aiChatReponse {
  border-radius: 0.5rem;
  border-width: 1px;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
  padding: 1rem;
}



.calendar {
  width: 100%;
  border-collapse: collapse;
}

.calendar th {
  border-width: 1px;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-bg-opacity)));
  padding: 0.5rem;
  text-align: center;
}

.calendar td {
  border-width: 1px;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
  padding: 0.5rem;
  vertical-align: top;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}

.calendar td:hover {
  background-color: var(--fallback-b3,oklch(var(--b3)/0.3));
}

.event-bar {
  margin-top: 0.25rem;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 0.25rem;
  padding: 0.25rem;
  font-size: 0.75rem;
  line-height: 1rem;
}

.event-room-1 {
  background-color: var(--fallback-p,oklch(var(--p)/0.3));
}

.event-room-1:hover {
  background-color: var(--fallback-p,oklch(var(--p)/0.4));
}

.event-room-2 {
  background-color: var(--fallback-s,oklch(var(--s)/0.3));
}

.event-room-2:hover {
  background-color: var(--fallback-s,oklch(var(--s)/0.4));
}



.modal-box {
  border-width: 1px;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
}



.btm-nav {
  border-top-width: 1px;
  --tw-border-opacity: 1;
  border-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-border-opacity)));
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
}

.btm-nav > *.active {
  --tw-border-opacity: 1;
  border-color: var(--fallback-p,oklch(var(--p)/var(--tw-border-opacity)));
}



.absolute {
  position: absolute;
}

.relative {
  position: relative;
}

.sticky {
  position: sticky;
}

.left-3 {
  left: 0.75rem;
}

.top-0 {
  top: 0px;
}

.top-1\/2 {
  top: 50%;
}

.top-20 {
  top: 5rem;
}

.z-50 {
  z-index: 50;
}

.mx-auto {
  margin-left: auto;
  margin-right: auto;
}

.my-2 {
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
}

.mb-2 {
  margin-bottom: 0.5rem;
}

.mb-4 {
  margin-bottom: 1rem;
}

.mb-6 {
  margin-bottom: 1.5rem;
}

.ml-2 {
  margin-left: 0.5rem;
}

.ml-auto {
  margin-left: auto;
}

.mt-2 {
  margin-top: 0.5rem;
}

.mt-4 {
  margin-top: 1rem;
}

.flex {
  display: flex;
}

.table {
  display: table;
}

.grid {
  display: grid;
}

.hidden {
  display: none;
}

.h-64 {
  height: 16rem;
}

.max-h-\[500px\] {
  max-height: 500px;
}

.max-h-\[calc\(100vh-200px\)\] {
  max-height: calc(100vh - 200px);
}

.min-h-\[100px\] {
  min-height: 100px;
}

.min-h-screen {
  min-height: 100vh;
}

.w-52 {
  width: 13rem;
}

.w-full {
  width: 100%;
}

.flex-1 {
  flex: 1 1 0%;
}

.-translate-y-1\/2 {
  --tw-translate-y: -50%;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
}

.grid-cols-1 {
  grid-template-columns: repeat(1, minmax(0, 1fr));
}

.flex-wrap {
  flex-wrap: wrap;
}

.items-center {
  align-items: center;
}

.justify-between {
  justify-content: space-between;
}

.gap-2 {
  gap: 0.5rem;
}

.gap-4 {
  gap: 1rem;
}

.gap-6 {
  gap: 1.5rem;
}

.space-y-4 > :not([hidden]) ~ :not([hidden]) {
  --tw-space-y-reverse: 0;
  margin-top: calc(1rem * calc(1 - var(--tw-space-y-reverse)));
  margin-bottom: calc(1rem * var(--tw-space-y-reverse));
}

.space-y-6 > :not([hidden]) ~ :not([hidden]) {
  --tw-space-y-reverse: 0;
  margin-top: calc(1.5rem * calc(1 - var(--tw-space-y-reverse)));
  margin-bottom: calc(1.5rem * var(--tw-space-y-reverse));
}

.space-y-8 > :not([hidden]) ~ :not([hidden]) {
  --tw-space-y-reverse: 0;
  margin-top: calc(2rem * calc(1 - var(--tw-space-y-reverse)));
  margin-bottom: calc(2rem * var(--tw-space-y-reverse));
}

.overflow-y-auto {
  overflow-y: auto;
}

.rounded-box {
  border-radius: var(--rounded-box, 1rem);
}

.rounded-lg {
  border-radius: 0.5rem;
}

.border {
  border-width: 1px;
}

.border-b {
  border-bottom-width: 1px;
}

.border-t {
  border-top-width: 1px;
}

.border-base-200 {
  --tw-border-opacity: 1;
  border-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-border-opacity)));
}

.border-base-300 {
  --tw-border-opacity: 1;
  border-color: var(--fallback-b3,oklch(var(--b3)/var(--tw-border-opacity)));
}

.bg-base-100 {
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b1,oklch(var(--b1)/var(--tw-bg-opacity)));
}

.bg-base-200 {
  --tw-bg-opacity: 1;
  background-color: var(--fallback-b2,oklch(var(--b2)/var(--tw-bg-opacity)));
}

.p-2 {
  padding: 0.5rem;
}

.p-4 {
  padding: 1rem;
}

.px-4 {
  padding-left: 1rem;
  padding-right: 1rem;
}

.py-3 {
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
}

.py-6 {
  padding-top: 1.5rem;
  padding-bottom: 1.5rem;
}

.pl-7 {
  padding-left: 1.75rem;
}

.pt-6 {
  padding-top: 1.5rem;
}

.text-2xl {
  font-size: 1.5rem;
  line-height: 2rem;
}

.text-base {
  font-size: 1rem;
  line-height: 1.5rem;
}

.text-lg {
  font-size: 1.125rem;
  line-height: 1.75rem;
}

.text-sm {
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.text-xl {
  font-size: 1.25rem;
  line-height: 1.75rem;
}

.font-bold {
  font-weight: 700;
}

.font-medium {
  font-weight: 500;
}

.font-semibold {
  font-weight: 600;
}

.text-base-content {
  --tw-text-opacity: 1;
  color: var(--fallback-bc,oklch(var(--bc)/var(--tw-text-opacity)));
}

.text-base-content\/70 {
  color: var(--fallback-bc,oklch(var(--bc)/0.7));
}

.text-primary {
  --tw-text-opacity: 1;
  color: var(--fallback-p,oklch(var(--p)/var(--tw-text-opacity)));
}

.text-secondary {
  --tw-text-opacity: 1;
  color: var(--fallback-s,oklch(var(--s)/var(--tw-text-opacity)));
}

.text-success {
  --tw-text-opacity: 1;
  color: var(--fallback-su,oklch(var(--su)/var(--tw-text-opacity)));
}

.text-warning {
  --tw-text-opacity: 1;
  color: var(--fallback-wa,oklch(var(--wa)/var(--tw-text-opacity)));
}

.shadow {
  --tw-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  --tw-shadow-colored: 0 1px 3px 0 var(--tw-shadow-color), 0 1px 2px -1px var(--tw-shadow-color);
  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
}

.shadow-lg {
  --tw-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --tw-shadow-colored: 0 10px 15px -3px var(--tw-shadow-color), 0 4px 6px -4px var(--tw-shadow-color);
  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
}

.filter {
  filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow);
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

.focus\:input-primary:focus {
  --tw-border-opacity: 1;
  border-color: var(--fallback-p,oklch(var(--p)/var(--tw-border-opacity)));
}

.focus\:input-primary:focus:focus,.focus\:input-primary:focus:focus-within {
  --tw-border-opacity: 1;
  border-color: var(--fallback-p,oklch(var(--p)/var(--tw-border-opacity)));
  outline-color: var(--fallback-p,oklch(var(--p)/1));
}

.focus\:outline-none:focus {
  outline: 2px solid transparent;
  outline-offset: 2px;
}

@media (min-width: 768px) {
  .md\:grid-cols-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .md\:grid-cols-3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 1024px) {
  .lg\:col-span-1 {
    grid-column: span 1 / span 1;
  }

  .lg\:col-span-3 {
    grid-column: span 3 / span 3;
  }

  .lg\:hidden {
    display: none;
  }

  .lg\:grid-cols-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .lg\:grid-cols-4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

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

        
        $('[data-toggle="tooltip"]').tooltip();

        
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
            const data = await $.get("/api/readGmail", { email: email, showCount: 25 });
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
        $.get("/api/getEventsContacts", (contacts) => {
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

    

    createCalendar() {
        this.mainCalendar = new Calendar('calendar');
        $.get("/getEventCalendar", (data) => {
            let eventData = ICAL.parse(data)[2];
            eventData.shift();
            eventData = eventData.map((o, i) => {
                o = o[1];
                const summary = _.find(o, x => x[0] === "summary");
                if (!summary) return null;
                const summaryText = summary[3];
                const timezone = 'America/New_York';
                o.startTime = moment.tz(o[0][3], "YYYYMMDDTHHmmssZ", timezone);
                o.endTime = moment.tz(o[1][3], "YYYYMMDDTHHmmssZ", timezone);
                let calendarEnd = o.endTime;
                if (o.endTime.isAfter(o.startTime.clone().hour(23).minute(59))) {
                    calendarEnd = o.startTime.clone().hour(23).minute(59);
                }
                const title = `${o.startTime.format("HHmm")} ${summaryText}`;
                return {
                    id: i,
                    calendarId: 1,
                    title: title,
                    category: "time",
                    isReadOnly: true,
                    startTime: o.startTime.format("YYYY-MM-DDTHH:mm:ss"),
                    labelEndTime: o.endTime.format("YYYY-MM-DDTHH:mm:ss"),
                    endTime: calendarEnd.format("YYYY-MM-DDTHH:mm:ss"),
                    o: o,
                    description: summary,
                    room: summaryText.includes("DiningRoom") ? "DiningRoom" : (summaryText.includes("Lounge") ? "Lounge" : "")
                };
            }).filter(o => o && o.room !== "");
            this.mainCalendar.loadEvents(eventData);
        });
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


//--- File: /home/luan_ngo/web/events/public/index.html ---

<html lang="en" data-theme="dark">
<head>
    <title>Event Management</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    
    <link href="https:
    <link href="https:
    <link href="/stylesheets/calendar.css" rel="stylesheet">
    <link href="/styles.css" rel="stylesheet">
</head>

<body class="min-h-screen bg-base-100">
    
    <header class="sticky top-0 z-50 bg-base-100 border-b border-base-200">
        <div class="container mx-auto px-4 py-3">
            <h1 class="text-2xl font-bold text-base-content">Event Management</h1>
        </div>
    </header>

    
    <div class="container mx-auto px-4 py-6">
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
                        <div class="space-y-8"> 
                            
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
                                            class="input input-bordered w-full focus:input-primary">
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Phone</span>
                                        </label>
                                        <input type="tel" id="actionsPhone" class="input input-bordered w-full"
                                            pattern="[0-9]{3}-[0-9]{3}-[0-9]{4}">
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Email</span>
                                        </label>
                                        <input type="email" id="infoEmail" class="input input-bordered w-full">
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
                                            class="input input-bordered w-full">
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">End Time</span>
                                        </label>
                                        <input type="datetime-local" id="infoEndTime"
                                            class="input input-bordered w-full">
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
                                        <input type="text" id="infoPartyType" class="input input-bordered w-full">
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Expected Attendance</span>
                                        </label>
                                        <input type="number" id="infoAttendance" class="input input-bordered w-full">
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Status</span>
                                        </label>
                                        <select multiple id="infoStatus" class="select select-bordered w-full">
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
                                        <select multiple id="infoRoom" class="select select-bordered w-full">
                                            <option value="Lounge">Lounge</option>
                                            <option value="DiningRoom">Dining Room</option>
                                            <option value="Patio">Patio</option>
                                        </select>
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Services</span>
                                        </label>
                                        <select multiple id="infoServices" class="select select-bordered w-full">
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
                                            <span class="absolute left-3 top-1/2 -translate-y-1/2">$</span>
                                            <input type="number" id="infoRentalRate"
                                                class="input input-bordered w-full pl-7">
                                        </div>
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Minimum Spend</span>
                                        </label>
                                        <div class="relative">
                                            <span class="absolute left-3 top-1/2 -translate-y-1/2">$</span>
                                            <input type="number" id="infoMinSpend"
                                                class="input input-bordered w-full pl-7">
                                        </div>
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Hourly Rate</span>
                                        </label>
                                        <div class="flex gap-2">
                                            <div class="relative flex-1">
                                                <span class="absolute left-3 top-1/2 -translate-y-1/2">$</span>
                                                <input type="number" id="hourlyRate"
                                                    class="input input-bordered w-full pl-7" value="125">
                                            </div>
                                            <button id="calcRate" class="btn btn-primary tooltip" data-tip="Calculate">
                                                <i class="bi bi-calculator"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            
                            <div class="space-y-4">
                                <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                    <i class="bi bi-journal-text"></i>
                                    Additional Notes
                                </h3>
                                <div class="form-control">
                                    <textarea id="infoNotes" rows="4" class="textarea textarea-bordered w-full"
                                        placeholder="Enter any additional notes or special requirements..."></textarea>
                                </div>
                            </div>

                            
                            <div class="border-t border-base-300 pt-6 flex flex-wrap gap-4 items-center">
                                <div class="flex flex-wrap gap-2">
                                    <button class="btn btn-primary tooltip" data-tip="Save" id="infoSave">
                                        <i class="bi bi-save"></i>
                                    </button>
                                    <button class="btn btn-secondary tooltip" data-tip="Add Contact"
                                        id="infoAddContact">
                                        <i class="bi bi-person-plus"></i>
                                    </button>
                                    <button class="btn btn-accent tooltip" data-tip="Receipt" id="receipt">
                                        <i class="bi bi-receipt"></i>
                                    </button>
                                    <button class="btn btn-accent tooltip" data-tip="Summarize" id="summarizeEvent">
                                        <i class="bi bi-file-earmark-text"></i>
                                    </button>
                                </div>
                                <label class="flex items-center gap-2 ml-auto">
                                    <input type="checkbox" class="checkbox checkbox-primary" id="depositCheck">
                                    <span>Include Deposit</span>
                                </label>
                            </div>

                            <div id="depositPw" class="text-sm text-base-content/70"></div>
                        </div>
                    </div>
                </section>

                
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    
                    <section id="messages" class="card bg-base-100 shadow-lg">
                        <div class="card-body">
                            <div class="flex justify-between items-center mb-4">
                                <h2 class="card-title text-lg">Messages</h2>
                                <div class="flex gap-2">
                                    <button class="btn btn-ghost btn-sm btn-square tooltip tooltip-left"
                                        data-tip="Read Email" id="readAllEmails">
                                        <i class="bi bi-envelope"></i>
                                    </button>
                                    <button class="btn btn-ghost btn-sm btn-square tooltip tooltip-left"
                                        data-tip="Summarize" id="summarizeLastEmails">
                                        <i class="bi bi-list-task"></i>
                                    </button>
                                    <button class="btn btn-ghost btn-sm btn-square tooltip tooltip-left"
                                        data-tip="Get Access" id="getAccess">
                                        <i class="bi bi-key"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="overflow-y-auto max-h-[500px] messages-container">
                                
                            </div>
                        </div>
                    </section>

                    
                    <section id="actions" class="card bg-base-100 shadow-lg">
                        <div class="card-body">
                            <h2 class="card-title text-lg mb-4">Actions & AI Assistant</h2>
                            <div class="flex flex-wrap gap-2 mb-4">
                                <button class="btn btn-primary tooltip" data-tip="Create Contract"
                                    id="actionsCreateContract">
                                    <i class="bi bi-file-text"></i>
                                </button>
                                <button class="btn btn-primary tooltip" data-tip="Email Contract"
                                    id="actionsEmailContract">
                                    <i class="bi bi-envelope"></i>
                                </button>
                                <button class="btn btn-primary tooltip" data-tip="Book Calendar"
                                    id="actionsBookCalendar">
                                    <i class="bi bi-calendar-check"></i>
                                </button>
                                <button class="btn btn-secondary tooltip" data-tip="Event AI" id="eventAI">
                                    <i class="bi bi-calendar-plus"></i>
                                </button>
                                <button class="btn btn-secondary tooltip" data-tip="Email AI" id="emailAI">
                                    <i class="bi bi-envelope"></i>
                                </button>
                            </div>

                            
                            <div class="bg-base-200 rounded-lg p-4">
                                <h3 class="font-bold mb-2">AI Conversation</h3>
                                <div class="overflow-y-auto h-64 mb-4 bg-base-100 rounded-lg p-2" id="aiResult">
                                </div>
                                <div class="flex items-center gap-2 mb-2">
                                    <h3 class="font-bold">Message</h3>
                                    <button id="toggleButton" class="btn btn-ghost btn-xs btn-square tooltip"
                                        data-tip="Expand">
                                        <i class="bi bi-arrows-fullscreen"></i>
                                    </button>
                                </div>
                                <div contenteditable="true"
                                    class="bg-base-100 rounded-lg p-2 min-h-[100px] focus:outline-none border border-base-300"
                                    id="aiText">
                                </div>
                                <div class="flex flex-wrap gap-2 mt-4">
                                    <button class="btn btn-accent tooltip" data-tip="Chat" id="actionSendAI">
                                        <i class="bi bi-chat-dots"></i>
                                    </button>
                                    <button class="btn btn-accent tooltip" data-tip="Confirm" id="confirmAI">
                                        <i class="bi bi-check-circle"></i>
                                    </button>
                                    <div class="flex items-center gap-2 flex-1">
                                        <input type="text" id="sendMailEmail" class="input input-bordered flex-1"
                                            placeholder="Email">
                                        <button class="btn btn-primary tooltip" data-tip="Send" id="sendEmail">
                                            <i class="bi bi-send"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>


                <section id="calendar" class="card bg-base-100 shadow-lg">
                    <div class="card-body">
                        <h2 class="card-title text-lg mb-4">Calendar</h2>
                        <div id="calendarContainer" class="w-full">
                            
                        </div>
                    </div>
                </section>
            </main>
        </div>
    </div>

    
    <nav class="btm-nav lg:hidden">
        <button class="active tooltip tooltip-top" data-tip="Contacts">
            <i class="bi bi-address-book text-xl"></i>
        </button>
        <button class="tooltip tooltip-top" data-tip="Event Details">
            <i class="bi bi-info-circle text-xl"></i>
        </button>
        <button class="tooltip tooltip-top" data-tip="Messages">
            <i class="bi bi-envelope text-xl"></i>
        </button>
        <button class="tooltip tooltip-top" data-tip="Actions">
            <i class="bi bi-list text-xl"></i>
        </button>
        <button class="tooltip tooltip-top" data-tip="Calendar">
            <i class="bi bi-calendar text-xl"></i>
        </button>
        <button onclick="window.user_settings_modal.showModal()" class="tooltip tooltip-top" data-tip="Settings">
            <i class="bi bi-gear text-xl"></i>
        </button>
    </nav>

    
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
                <h3 class="font-bold mb-2">Theme</h3>
                <select class="select select-bordered w-full" id="themeSelect">
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                </select>
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
    <script src="https:
    <script src="https:
    <script src="https:
    <script src="/calendar.js"></script>
    <script type="module">
        import { EventManageApp } from '/scripts.js';
        window.app = new EventManageApp();

        
        const themeSelect = document.getElementById('themeSelect');
        themeSelect.value = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', themeSelect.value);

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
                    <a id="left" href="#" class="btn btn-outline-primary btn-sm" data-toggle="tooltip" title="Previous Month">
                        <i class="bi bi-chevron-left"></i>
                    </a>
                    <a id="right" href="#" class="btn btn-outline-primary btn-sm" data-toggle="tooltip" title="Next Month">
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
                const roomClass = roomClasses[event.room] || "gray"; 
                html += `<div class="event-bar ${roomClass}" data-eventid="${event.id}" title="${event.title}: ${event.description}" >${event.title}</div>`;
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








//--- File: /home/luan_ngo/web/events/src/styles.css ---
@tailwind base;
@tailwind components;
@tailwind utilities;

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

  .input, .select, .textarea {
    @apply bg-base-100 border-base-300 transition-all duration-200;
    @apply focus:ring-2 focus:ring-primary/20 focus:border-primary;
    @apply disabled:bg-base-200 disabled:cursor-not-allowed;
  }

  
  .messages-container {
    @apply space-y-4;
  }

  .sms {
    @apply bg-base-200 border border-base-300 rounded-lg p-4;
    @apply transition-all duration-200 hover:shadow-md;
  }

  
  .contactCont {
    @apply p-2 hover:bg-base-300/50 rounded-lg transition-colors;
  }

  
  .btn {
    @apply transition-all duration-200;
  }

  .btn:active {
    @apply scale-95;
  }

  
  #aiResult {
    @apply space-y-4 bg-base-100;
  }

  .aiChatReponse {
    @apply bg-base-200 border border-base-300 rounded-lg p-4;
  }

  
  .calendar {
    @apply w-full border-collapse;
  }

  .calendar th {
    @apply p-2 text-center border border-base-300 bg-base-300;
  }

  .calendar td {
    @apply p-2 border border-base-300 align-top bg-base-100;
    @apply transition-colors hover:bg-base-300/30;
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

  
  .modal-box {
    @apply bg-base-200 border border-base-300;
  }

  
  .btm-nav {
    @apply bg-base-200 border-t border-base-300;
  }

  .btm-nav > *.active {
    @apply border-primary;
  }

  
  .custom-scrollbar::-webkit-scrollbar {
    @apply w-2;
  }

  .custom-scrollbar::-webkit-scrollbar-track {
    @apply bg-base-100;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb {
    @apply bg-base-300 rounded-full hover:bg-base-300/70;
  }
}

@layer utilities {
  .fade-in {
    animation: fadeIn 0.3s ease-in-out;
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

  .slide-in {
    animation: slideIn 0.3s ease-in-out;
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
}
