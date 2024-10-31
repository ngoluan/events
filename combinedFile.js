
//--- File: /home/luan_ngo/web/events/services/gmailService.js ---
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

class GmailService {
    constructor(auth) {
        this.auth = auth;
        this.cacheFilePath = path.join(__dirname, '..', 'data', 'emails.json');


    }
    saveEmailsToCache(emails) {
        fs.writeFileSync(this.cacheFilePath, JSON.stringify(emails, null, 2), 'utf8');
      }

      loadEmailsFromCache() {
        if (fs.existsSync(this.cacheFilePath)) {
          const data = fs.readFileSync(this.cacheFilePath, 'utf8');
          return JSON.parse(data);
        }
        return [];
      }
    async listMessages(userEmail, gmailEmail, showCount, labelIds = []) {
        try {
            const authClient = await this.auth.getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth: authClient });

            const res = await gmail.users.messages.list({
                userId: 'me',
                maxResults: showCount,
                q: gmailEmail ? `to:${gmailEmail}` : '',
                labelIds: labelIds.length > 0 ? labelIds : undefined,
            });
            return res.data.messages || [];
        } catch (error) {
            console.error('Error listing messages:', error);
            throw error;
        }
    }
    async getMessage(messageId) {
        try {
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
}


module.exports = GmailService;

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


//--- File: /home/luan_ngo/web/events/routes/gmail.js ---
const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');

module.exports = (googleAuth) => {
    const gmail = new gmailService(googleAuth);

    router.get('/readGmail', async (req, res) => {
        try {
            const emailQuery = req.query.email || 'all';
            const showCount = parseInt(req.query.showCount) || 25;
            const labelIds = ['INBOX', 'SENT'];

            console.log(`Reading Gmail for ${emailQuery}, count: ${showCount}`);

            let cachedEmails = gmail.loadEmailsFromCache();
            let cachedEmailMap = {};
            cachedEmails.forEach(email => {
                cachedEmailMap[email.id] = email;
            });

            const messages = await gmail.listMessages(emailQuery, null, showCount, labelIds);
            let allEmails = [];
            let emailsToCheckForReplies = [];

            const asyncLib = require('async');
            asyncLib.mapLimit(
                messages,
                10,
                async (message) => {
                    try {
                        if (cachedEmailMap[message.id]) {
                            const emailData = cachedEmailMap[message.id];
                            allEmails.push(emailData);
                            return emailData;
                        }

                        const fullMessage = await gmail.getMessage(message.id);
                        const content = await gmail.parseEmailContent(fullMessage);

                        const emailData = {
                            id: message.id,
                            threadId: message.threadId,
                            from: fullMessage.payload.headers.find((h) => h.name === 'From')?.value || '',
                            to: fullMessage.payload.headers.find((h) => h.name === 'To')?.value || '',
                            subject: fullMessage.payload.headers.find((h) => h.name === 'Subject')?.value || '',
                            timestamp: fullMessage.payload.headers.find((h) => h.name === 'Date')?.value || '',
                            internalDate: fullMessage.internalDate,
                            text: content,
                            labels: fullMessage.labelIds || [],
                        };
                        console.log(`Fetching message ID ${message.id}`);

                        cachedEmailMap[message.id] = emailData;
                        allEmails.push(emailData);

                        
                        if (!emailData.labels.includes('SENT')) {
                            emailsToCheckForReplies.push(emailData);
                        } else {
                            
                            emailData.replied = null;
                        }

                        return emailData;
                    } catch (err) {
                        console.error(`Error processing message ID ${message.id}:`, err);
                        return null;
                    }
                },
                async (err, fullMessages) => {
                    if (err) {
                        console.error('Error processing messages:', err);
                        return res.status(500).json({
                            error: 'Error processing messages',
                            details: err.message,
                        });
                    }

                    const validMessages = fullMessages.filter((msg) => msg !== null);

                    
                    if (emailsToCheckForReplies.length > 0) {
                        await checkForReplies(emailsToCheckForReplies, cachedEmailMap);
                    }

                    const updatedEmails = Object.values(cachedEmailMap);
                    gmail.saveEmailsToCache(updatedEmails);

                    res.json(updatedEmails);
                }
            );
        } catch (error) {
            console.error('Error reading Gmail:', error);
            res.status(500).json({
                error: 'Error reading Gmail',
                details: error.message,
            });
        }
    });

    router.get('/messages/:id', async (req, res) => {
        try {
            const message = await gmail.getMessage(req.params.id);
            const content = await gmail.parseEmailContent(message);
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
                const threadMessages = await gmail.getThreadMessages(threadId);
                
                
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

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('oauth') === 'success') {
            
            const response = await $.get('/api/getConnectedEmail');
            if (response.email) {
                this.setConnectedEmail(response.email);
            }
        }


    }
    
    adjustMessagesContainerHeight() {
        const messagesCard = document.querySelector('#messages .card-body');
        const messagesContainer = document.querySelector('.messages-container');

        if (!messagesCard || !messagesContainer) return;

        
        const cardHeight = messagesCard.offsetHeight;

        
        const otherElements = messagesCard.querySelectorAll('.card-title ');
        let otherElementsHeight = 0;
        otherElements.forEach(element => {
            
            if (window.getComputedStyle(element).display !== 'none') {
                otherElementsHeight += element.offsetHeight;
            }
        });

        
        const containerStyle = window.getComputedStyle(messagesContainer);
        const verticalPadding = parseFloat(containerStyle.paddingTop) +
            parseFloat(containerStyle.paddingBottom) +
            parseFloat(containerStyle.marginTop) +
            parseFloat(containerStyle.marginBottom);

        
        const newHeight = cardHeight - otherElementsHeight - verticalPadding;
        messagesContainer.style.maxHeight = `${Math.max(newHeight, 100)}px`; 
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
        
        $("#messages").find(".content").empty();

        this.adjustMessagesContainerHeight();

        
        $("#messages").find(".content").html(`
            <div class="alert alert-info">
                <i class="bi bi-hourglass-split"></i>
                Loading emails...
            </div>
        `);

        if (retrieveEmail) {
            try {
                await $.get("/api/retrieveGmail");
                console.log("Email retrieval complete");
            } catch (error) {
                console.error("Failed to retrieve Gmail:", error);
                $("#messages").find(".content").html(`
                    <div class="alert alert-danger">
                        <i class="bi bi-exclamation-triangle"></i>
                        Failed to retrieve emails: ${error.message}
                    </div>
                `);
                return;
            }
        }

        try {
            const response = await $.get("/gmail/readGmail", {
                email: email,
                showCount: 25
            });

            if (!Array.isArray(response)) {
                console.error("Invalid response format:", response);
                $("#messages").find(".content").html(`
                    <div class="alert alert-danger">
                        <i class="bi bi-exclamation-triangle"></i>
                        Unexpected response format from server
                    </div>
                `);
                return;
            }

            if (response.length > 0) {
                this.processEmails(response);
                
            } else {
                $("#messages").find(".content").html(`
                    <div class="alert alert-info">
                        <i class="bi bi-info-circle"></i>
                        No emails found
                    </div>
                `);
            }
        } catch (error) {
            console.error("Failed to read Gmail:", error);
            $("#messages").find(".content").html(`
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle"></i>
                    Failed to load emails: ${error.message || 'Unknown error'}
                </div>
            `);
        }

        
    }

    processEmails(data) {
        if (!Array.isArray(data)) {
            console.error("Invalid data format:", data);
            return;
        }

        data = _.orderBy(data, ["timestamp"], ["desc"]);
        const exclusionArray = ["calendar-notification", "accepted this invitation", "peerspace", "tagvenue"];
        let html = '';

        data.forEach((email) => {
            if (!email || !email.subject || !email.text) {
                console.warn("Skipping invalid email entry:", email);
                return;
            }

            if (exclusionArray.some((exclusion) =>
                email.subject.toLowerCase().includes(exclusion) ||
                email.text.toLowerCase().includes(exclusion)
            )) {
                return;
            }

            const emailAddressMatch = email.from.match(/<([^>]+)>/);
            const emailAddress = emailAddressMatch ? emailAddressMatch[1] : email.from;

            if (emailAddress !== "INTERAC" && email.text) {
                email.text = email.text.replace(/\n/g, "<br>");
            }

            const isUnread = email.labels && email.labels.includes("UNREAD");
            const isImportant = email.labels && email.labels.includes("IMPORTANT");
            const unreadIcon = isUnread
                ? `<i class="bi bi-envelope-open-text text-warning" title="Unread"></i> `
                : `<i class="bi bi-envelope text-secondary" title="Read"></i> `;
            const importantIcon = isImportant
                ? `<i class="bi bi-star-fill text-danger" title="Important"></i> `
                : "";

            html += `
                <div class="sms" subject="${_.escape(email.subject)}" to="${_.escape(emailAddress)}" data-id="${_.escape(email.id)}">
                    <div class="flex items-center justify-between">
                        <button class="toggle-button">
                            <i class="bi bi-chevron-down"></i>
                        </button>
                        <div class="flex gap-2">
                            ${unreadIcon}
                            ${importantIcon}
                        </div>
                    </div>
                    
                    <div class="email">
                        <div class="email-header">
                            <div><strong>From:</strong> ${_.escape(email.from)}</div>
                            <div><strong>To:</strong> ${_.escape(email.to)}</div>
                            <div><strong>Subject:</strong> ${_.escape(email.subject)}</div>
                            <div><strong>Time:</strong> ${moment.tz(email.timestamp, 'America/New_York').format("MM/DD/YYYY HH:mm")}</div>
                        </div>
                        <div class="email-body">
                            ${email.text}
                        </div>
                    </div>
    
                    <div class="action-buttons">
                        <button class="btn btn-sm btn-primary summarizeEmailAI" title="Summarize">
                            <i class="bi bi-list-task"></i> Summarize
                        </button>
                        <button class="btn btn-sm btn-primary draftEventSpecificEmail" title="Draft Event Specific Email">
                            <i class="bi bi-pencil"></i> Draft
                        </button>
                        <button class="btn btn-sm btn-primary getEventDetails" data-id="${_.escape(email.id)}" title="Send Event Info to AI">
                            <i class="bi bi-calendar-plus"></i> Event Info
                        </button>
                        <button class="btn btn-sm btn-primary generateConfirmationEmail" data-id="${_.escape(email.id)}" title="Generate Confirmation Email">
                            <i class="bi bi-envelope"></i> Confirm
                        </button>
                        <button class="btn btn-sm btn-primary sendToAiTextArea" subject="${_.escape(email.subject)}" to="${_.escape(emailAddress)}" data-id="${_.escape(email.id)}" title="Send to AI textarea">
                            <i class="bi bi-send"></i> Send to AI
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
                    No matching emails found
                </div>
            `);
        }
    }

    
    processEmails(data) {
        if (!Array.isArray(data)) {
            console.error("Invalid data format:", data);
            return;
        }

        data = _.orderBy(data, ["timestamp"], ["desc"]);
        const exclusionArray = ["calendar-notification", "accepted this invitation", "peerspace", "tagvenue"];
        let html = '';

        data.forEach((ele) => {
            
            if (!ele || !ele.subject || !ele.text) {
                console.warn("Skipping invalid email entry:", ele);
                return;
            }

            if (exclusionArray.some((exclusion) =>
                ele.subject.toLowerCase().includes(exclusion) ||
                ele.text.toLowerCase().includes(exclusion)
            )) {
                return;
            }

            const emailAddressMatch = ele.from.match(/<([^>]+)>/);
            const emailAddress = emailAddressMatch ? emailAddressMatch[1] : ele.from;

            
            if (emailAddress !== "INTERAC" && ele.text) {
                ele.text = ele.text.replace(/\n/g, "<br>");
            }

            const isUnread = ele.labels && ele.labels.includes("UNREAD");
            const isImportant = ele.labels && ele.labels.includes("IMPORTANT");
            const unreadIcon = isUnread
                ? `<i class="bi bi-envelope-open-text text-warning" title="Unread"></i> `
                : `<i class="bi bi-envelope text-secondary" title="Read"></i> `;
            const importantIcon = isImportant
                ? `<i class="bi bi-star-fill text-danger" title="Important"></i> `
                : "";

            html += `
                <div class="sms" subject="${_.escape(ele.subject)}" to="${_.escape(emailAddress)}" data-id="${_.escape(ele.id)}">
                    <a href="#" class="toggle-button"><i class="bi bi-three-dots"></i></a>
                    <div class="email">
                        <strong>${unreadIcon}${importantIcon}From:</strong> ${_.escape(ele.from)} <br>
                        <strong>To:</strong> ${_.escape(ele.to)}<br>
                        <strong>Subject:</strong> ${_.escape(ele.subject)}<br>
                        <strong>Time:</strong> ${moment.tz(ele.timestamp, 'America/New_York').format("MM/DD/YYYY HH:mm")}<br>
                        ${ele.text}
                    </div>
                    <div class="flex gap-2 mt-2">
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
                    </div>
                </div>`;
        });

        if (html) {
            $("#messages .messages-container").html(html);
        } else {
            $("#messages .messages-container").html(`
                <div class="alert alert-info">
                    <i class="bi bi-info-circle"></i>
                    No matching emails found
                </div>
            `);
        }
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

  .input,
  .select,
  .textarea {
    @apply bg-base-100 border-base-300 transition-all duration-200;
    @apply focus:ring-2 focus:ring-primary/20 focus:border-primary;
    @apply disabled:bg-base-200 disabled:cursor-not-allowed;
  }

  .messages-container {
    @apply flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4;
    
    min-height: 100px;
    
  }

  
  .messages-container {
    transition: height 0.2s ease-in-out;
  }

  
  #messages {
    @apply flex flex-col;
    height: 100%;
    
  }

  .sms {
    @apply bg-white border border-gray-200 rounded-lg transition-all duration-200;
    max-width: 100%;
  }


  .email {
    @apply mt-3 transition-all duration-200 overflow-hidden;
    max-height: 150px;
    
  }

  .email.expanded {
    max-height: none;
  }

  .email-header {
    @apply mb-2 text-sm text-gray-600;
  }

  .email-body {
    @apply text-gray-800 whitespace-pre-line;
  }

  .action-buttons {
    @apply flex flex-wrap gap-2 mt-3;
  }

  .action-buttons .btn {
    @apply text-sm px-3 py-1;
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

  .btm-nav>*.active {
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
