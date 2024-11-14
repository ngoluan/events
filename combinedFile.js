
//--- File: /home/luan_ngo/web/events/services/eventService.js ---

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const gmailService = require('./gmailService');
const GoogleCalendarService = require('./googleCalendarService');
const aiService = require('./aiService');
const moment = require('moment-timezone');
class EventService {
  constructor(googleAuth) {
    this.eventsFilePath = path.join(__dirname, '..', 'data', 'events.json');
    this.remoteApiGetUrl = 'https:
    this.remoteApiUpdateUrl = 'https:
    this.gmail = new gmailService(googleAuth);
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

//--- File: /home/luan_ngo/web/events/routes/events.js ---


const express = require('express');
const router = express.Router();
const EventService = require('../services/eventService');
const pdfService = require('../services/pdfService');
module.exports = (googleAuth) => {

  const eventService = new EventService(googleAuth);

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

//--- File: /home/luan_ngo/web/events/public/scripts.js ---



export class EventManageApp {
    constructor() {
        this.calendarEvents = [];
        this.mainCalendar = null;
        this.contacts = [];
        this.currentId = -1;
        this.emailProcessor = new EmailProcessor(this);
        this.templates = {};
        this.userEmail = '';
        const showRepliedSetting = localStorage.getItem('showRepliedEmails');
        this.emailFilters = {
            showReplied: showRepliedSetting === null ? true : showRepliedSetting === 'true'
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
        this.syncEvents();
        this.initializeMaximizeButtons();



        
        await this.loadTemplates();

        
        this.registerEvents();

        
        this.getAllContacts();
        this.createCalendar();
        
        await this.loadInitialEmails();


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
            button.addEventListener('click', function() {
                
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
        this.writeToAIResult(data.replace(/\n/g, "<br>"));
    }

    writeToAIResult(data) {
        data = data.replace(/\n/g, "<br>");
        data = data.replace(/:\[Specific Instructions:.*?\]/g, "");

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
    toggleRepliedEmails(e) {
        
        this.emailFilters.showReplied = !this.emailFilters.showReplied;

        
        localStorage.setItem('showRepliedEmails', this.emailFilters.showReplied);

        
        const $button = $(e.currentTarget);
        if (this.emailFilters.showReplied) {
            $button.html('<i class="bi bi-eye-slash"></i> Hide Replied');
            $button.attr('data-tip', 'Hide Replied Emails');
        } else {
            $button.html('<i class="bi bi-eye"></i> Show All');
            $button.attr('data-tip', 'Show All Emails');
        }

        
        $button.addClass('animate-press');
        setTimeout(() => $button.removeClass('animate-press'), 200);

        
        this.readGmail("all", false).then(() => {
            console.log("Emails refreshed. Show replied:", this.emailFilters.showReplied);
        }).catch(error => {
            console.error("Error refreshing emails:", error);
        });
    }


    toggleRepliedEmails(e) {
        
        this.emailFilters.showReplied = !this.emailFilters.showReplied;

        
        localStorage.setItem('showRepliedEmails', this.emailFilters.showReplied);

        
        const $button = $(e.currentTarget);
        if (this.emailFilters.showReplied) {
            $button.html('<i class="bi bi-eye-slash"></i> Hide Replied');
            $button.attr('data-tip', 'Hide Replied Emails');
        } else {
            $button.html('<i class="bi bi-eye"></i> Show All');
            $button.attr('data-tip', 'Show All Emails');
        }

        
        $button.addClass('animate-press');
        setTimeout(() => $button.removeClass('animate-press'), 200);

        
        this.refreshEmails();
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
                const now = moment().startOf('day');

                
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

        $('#toggleRepliedEmails').on('click', (e) => {
            e.preventDefault();
            this.toggleRepliedEmails(e);
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

        $(document).on("click", "#actionSendAI", (e) => {
            e.preventDefault();
            const val = $("#aiText").text() + `\n\nBe concise and semi-formal in the response.`;
            this.sendAIRequest(val);
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
        const aiText = $("#aiText").html();
        const to = $("#sendMailEmail").val();
        const subject = $("#sendMailSubject").val(); 
        if (!confirm("Are you sure you want to send this email?")) return;
        try {
            const data = await $.post("/gmail/sendEmail", { html: aiText, to: to, subject: subject });
            console.log(data);
            this.showToast("Email sent successfully.", "success");
        } catch (error) {
            console.error("Failed to send email:", error);
            this.showToast("Failed to send email.", "error");
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
    async readGmail(email = null) {
        this.adjustMessagesContainerHeight();
        $("#messages").find(".content").empty();
        $("#messages").find(".content").html(`
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
                response = await $.get("/gmail/readGmail", {
                    type: 'all',
                    forceRefresh: false,
                    orderBy: 'timestamp',
                    order: 'desc',
                    showReplied: this.emailFilters.showReplied 
                });
            }

            if (Array.isArray(response)) {
                console.log(`Processing ${response.length} emails. Show replied: ${this.emailFilters.showReplied}`);
                this.processEmails(response);
            } else {
                throw new Error("Invalid response format");
            }

            return response;
        } catch (error) {
            console.error("Failed to read Gmail:", error);
            $("#messages").find(".content").html(`
                <div class="alert alert-danger">
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
    processEmails(data) {
        if (!Array.isArray(data)) {
            console.error("Invalid data format:", data);
            return;
        }
        const filteredEmails = data
            .filter(email => this.emailFilters.showReplied || !email.replied)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

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

            const emailAddressMatch = email.from.match(/<([^>]+)>/);
            const emailAddress = emailAddressMatch ? emailAddressMatch[1] : email.from;

            if (exclusionArray.some((exclusion) =>
                email.subject.toLowerCase().includes(exclusion) ||
                emailContent.toLowerCase().includes(exclusion)
            )) {
                return;
            }

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
                    No ${!this.emailFilters.showReplied ? 'unreplied' : ''} emails found
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

    


    
    getAllContacts() {
        fetch("/api/events")
            .then(response => response.json())
            .then(contacts => {
                
                this.contacts = contacts.map(contact => ({
                    ...contact,
                    createdAt: contact.createdAt || new Date().toISOString()
                }));
                this.renderContactsWithCalendarSync();
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

            
            this.calendarEvents = data.map((event, index) => {
                const timezone = 'America/New_York';
                const startTime = moment.tz(event.start.dateTime || event.start.date, timezone);
                const endTime = moment.tz(event.end.dateTime || event.end.date, timezone);

                
                const contact = this.contacts.find(c => {
                    const contactDate = moment.tz(c.startTime, timezone).format('YYYY-MM-DD');
                    const eventDate = startTime.format('YYYY-MM-DD');
                    return c.name && event.summary.toLowerCase().includes(c.name.toLowerCase()) && contactDate === eventDate;
                });

                
                const attendanceInfo = contact?.attendance ? ` (${contact.attendance} ppl)` : '';
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
                    attendance: contact?.attendance
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
        
        const eventMap = new Map();
        this.calendarEvents.forEach(event => {
            const eventDate = moment.tz(event.startTime, 'America/New_York').format('YYYY-MM-DD');
            const eventKey = `${event.title.toLowerCase()}_${eventDate}`;
            eventMap.set(eventKey, event);
        });

        
        const $contactsContent = $("#contacts");
        $contactsContent.empty();
        let html = '';

        this.contacts.slice().reverse().forEach(contact => {
            if (!contact || !contact.startTime || !contact.name) return;

            const contactDate = moment.tz(contact.startTime, 'America/New_York');
            const formattedDate = contactDate.format("MM/DD/YYYY");
            const lookupKey = `${contact.name.toLowerCase()}_${contactDate.format('YYYY-MM-DD')}`;

            let colour = "blue";
            let statusIcons = '';

            
            const hasCalendarEntry = eventMap.has(lookupKey);

            if (hasCalendarEntry) {
                statusIcons += '<i class="bi bi-calendar-check-fill text-success ml-2"></i>';
            } else {
                
                if (contact.status) {
                    if (contact.status.includes("depositPaid")) {
                        statusIcons += '<i class="bi bi-cash text-success ml-2"></i>';
                    }
                    if (contact.status.includes("reserved")) {
                        statusIcons += '<i class="bi bi-bookmark-check text-primary ml-2"></i>';
                    }
                }
                if (contactDate.isBefore(moment().subtract(2, "days"))) {
                    colour = "lightgrey";
                }
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

        $contactsContent.append(html);
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

        if (contact.email) {
            this.readGmail(contact.email);
        }
        $("#depositPw").html(this.calcDepositPassword(contact));
    }

    calcDepositPassword(contact) {
        return moment.tz(contact.startTime, 'America/New_York').format("MMMMDD");
    }
    async initializeBackgroundInfo() {
        try {
            const response = await fetch('/api/settings/background');
            if (response.ok) {
                const data = await response.json();
                this.backgroundInfo = data.backgroundInfo;  
                $('#backgroundInfo').val(this.backgroundInfo);  
            }
        } catch (error) {
            console.error('Failed to load background info:', error);
        }

        
        $('#saveBackgroundInfo').on('click', () => this.saveBackgroundInfo());
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
    async createCalendar() {
        this.mainCalendar = new Calendar('calendar');
        try {
            const data = await $.get("/calendar/getEventCalendar");

            
            this.calendarEvents = data.map((event, index) => {
                const timezone = 'America/New_York';
                const startTime = moment.tz(event.start.dateTime || event.start.date, timezone);
                const endTime = moment.tz(event.end.dateTime || event.end.date, timezone);

                
                const contact = this.contacts.find(c => {
                    const contactDate = moment.tz(c.startTime, timezone).format('YYYY-MM-DD');
                    const eventDate = startTime.format('YYYY-MM-DD');
                    return c.name && event.summary.toLowerCase().includes(c.name.toLowerCase()) && contactDate === eventDate;
                });

                
                const attendance = contact?.attendance ? ` (${contact.attendance} ppl)` : '';
                event.summary = `${event.summary} <br>${startTime.format("HHmm")}-${endTime.format("HHmm")}${attendance}`;

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
                    attendance: contact?.attendance
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


    

    saveContactInfo() {
        let contact = _.find(this.contacts, ["id", this.currentId]);
        if (!contact) {
            
            contact = {};
        }
        contact.id = parseInt(contact.id) || null;
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

        
        if (contact.id) {
            
            $.ajax({
                url: `/api/events/${contact.id}`,
                type: 'PUT',
                data: JSON.stringify(contact),
                contentType: 'application/json',
                success: (response) => {
                    this.showToast("Contact updated", "success");
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


    async summarizeLastEmails() {
        try {
            const data = await $.get("/api/readGmail", { email: "all", showCount: 50 });
            let text = `Summarize all these previous email conversations from the last day.\n\n`;
            data.slice(0, 15).forEach(email => {
                const emailText = email.text.replace(/<[^>]*>?/gm, '');
                text += `From: ${email.from}<br>Subject: ${email.subject}<br>Timestamp: ${email.timestamp}<br>To: ${email.to}<br>Text: ${emailText}<br><br>`;
            });
            $("#aiText").html(text);
            
            const summary = await this.sendAIRequest("/api/sendAIText", {
                aiText: $("#aiText").text(),
                includeBackground: false  
            });
            this.writeToAIResult(summary);
            this.sounds.orderUp.play();
        } catch (error) {
            console.error("Failed to summarize last emails:", error);
        }
    }
}


//--- File: /home/luan_ngo/web/events/public/index.html ---

<html lang="en">

<head>
    <title>Event Management</title>
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
        <div class="container mx-auto px-4 py-3">
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
                                            <option value="kareoke">kareoke</option>
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
                                    <button class="btn btn-accent tooltip" data-tip="Add Deposit Info"
                                        id="generateDeposit">
                                        <i class="bi bi-cash"></i>
                                    </button>
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
                                </div>


                            </div>

                            <div id="depositPw" class="text-sm text-base-content/70"></div>
                        </div>
                    </div>
                </section>

                
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    
                    <section id="messages" class="card bg-base-100 shadow-lg h-[75vh]">
                        <div class="card-body flex flex-col">
                            <div class="flex justify-between items-center mb-4">
                                <h2 class="card-title text-lg">Messages</h2>
                                <div class="flex gap-2">
                                    <button class="btn btn-sm gap-2 tooltip tooltip-left" data-tip="Hide Replied Emails"
                                        id="toggleRepliedEmails">
                                        <i class="bi bi-eye-slash"></i>
                                    </button>
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
                            <div class="overflow-y-auto messages-container">
                                
                            </div>
                        </div>
                    </section>

                    
                    <section id="actions" class="card bg-base-100 shadow-lg">
                        <div class="card-body">
                            <h2 class="card-title text-lg mb-4">Actions & AI Assistant</h2>
                            <div class="flex flex-wrap gap-2 mb-4">

                                <button class="btn btn-secondary tooltip" data-tip="Event AI" id="eventAI">
                                    <i class="bi bi-calendar-plus"></i>
                                </button>
                                <button class="btn btn-secondary tooltip" data-tip="Email AI" id="emailAI">
                                    <i class="bi bi-envelope"></i>
                                </button>
                            </div>

                            
                            <div class="bg-base-200 rounded-lg p-4">
                                
                                <div class="flex justify-between items-center mb-2">
                                    <h3 class="font-bold">AI Conversation</h3>
                                    <button id="maximizeAiResult" class="btn btn-ghost btn-xs btn-square tooltip"
                                        data-tip="Maximize">
                                        <i class="bi bi-arrows-fullscreen"></i>
                                    </button>
                                </div>
                                <div class="overflow-y-auto h-64 mb-4 bg-base-100 rounded-lg p-2" id="aiResult">
                                </div>
                                <div class="flex items-center gap-2 mb-2">
                                    <h3 class="font-bold">Message</h3>
                                    <button id="toggleButton" class="btn btn-ghost btn-xs btn-square tooltip"
                                        data-tip="Expand">
                                        <i class="bi bi-arrows-fullscreen"></i>
                                    </button>
                                </div>
                                <div contenteditable="true" style="max-height: 400px; overflow-y: scroll;"
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
                                    <button id="clearAiText" class="btn btn-ghost btn-xs btn-square tooltip"
                                        data-tip="Clear">
                                        <i class="bi bi-trash"></i>
                                    </button>
                                    <div class="flex items-center gap-2 flex-1">
                                        <input type="text" id="sendMailEmail" class="input input-bordered flex-1"
                                            placeholder="Email">
                                        <input type="text" id="sendMailSubject" class="input input-bordered flex-1"
                                            placeholder="Subject">
                                        <button class="btn btn-primary tooltip" data-tip="Send" id="sendEmail">
                                            <i class="bi bi-send"></i>
                                        </button>
                                    </div>

                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </div>
        <div class="container py-6">
            <section id="calendar" class="card bg-base-100 shadow-lg">
                <div class="card-body">
                    <h2 class="card-title text-lg mb-4">Calendar</h2>
                    <div id="calendarContainer" class="w-full">
                        
                    </div>
                </div>
            </section>
        </div>
    </div>


    <div class="md:hidden btm-nav "> 
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
                <h3 class="font-bold mb-2">Theme</h3>
                <select class="select select-bordered w-full" id="themeSelect">
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                </select>
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

//--- File: /home/luan_ngo/web/events/public/EmailProcessor.js ---
class EmailProcessor {
    constructor(parent) {
        this.currentConversationId = null;
        this.registerEvents();
        this.parent = parent;

    }

    registerEvents() {
        
        $(document).on('click', '.summarizeEmailAI', async (e) => {
            e.preventDefault();
            const emailContent = $(e.target).closest('.sms').find('.email').text();
            await this.handleSummarizeEmail(emailContent);
        });

        
        $(document).on('click', '.draftEventSpecificEmail', async (e) => {
            e.preventDefault();
            const $emailContainer = $(e.target).closest('.sms');

            const emailContent = $(e.target).closest('.sms').find('.email').text();
            const subject = $emailContainer.attr('subject') || '';
            await this.handleDraftEventEmail(emailContent, subject);
        });

        
        $(document).on('click', '.sendToAiTextArea', async (e) => {
            e.preventDefault();
            const $emailContainer = $(e.target).closest('.sms');

            const emailContent = $emailContainer.find('.email').text();
            const subject = $emailContainer.attr('subject') || '';
            this.sendToAiTextArea(emailContent, subject);
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

            
            this.parent.writeToAIResult( response.summary);

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
    async handleDraftEventEmail(emailContent, subject) {
        try {
            const instructions = prompt('Enter any specific instructions for the email draft:');
            const combinedText = `${emailContent}\n\n[Specific Instructions: ${instructions}]`;

            const response = await $.post('/api/getAIEmail', {
                aiText: combinedText,
                emailText: emailContent,
                conversationId: this.currentConversationId,
                includeBackground: true
            });

            
            this.currentConversationId = response.conversationId;

            
            const formattedResponse = response.response ? response.response.toString().replace(/\n/g, '<br>') : '';

            
            const data = {
                content: formattedResponse,
                messageCount: response.messageCount || 0,
                isNewConversation: !this.currentConversationId
            };

            this.parent.writeToAIResult(data.content);

            
            if (subject) {
                if (subject.toLowerCase().startsWith('re:')) {
                    $('#sendMailSubject').val(subject);
                } else {
                    $('#sendMailSubject').val(`Re: ${subject}`);
                }
            }

            
            if ($('#sendMailEmail').val() === '' && response.fromEmail) {
                $('#sendMailEmail').val(response.fromEmail);
            }

            
            if (window.app.sounds && window.app.sounds.orderUp) {
                window.app.sounds.orderUp.play();
            }

        } catch (error) {
            console.error('Error drafting event email:', error);
            window.app.showToast('Failed to draft event email', 'error');
        }
    }
    sendToAiTextArea(emailContent, subject) {
        
        if (!this.currentConversationId) {
            $('#aiText').html('');
        }
        if (subject) {
            if (subject.toLowerCase().startsWith('re:')) {
                $('#sendMailSubject').val(subject);
            } else {
                $('#sendMailSubject').val(`Re: ${subject}`);
            }
        }
        
        const formattedContent = emailContent.replace(/\n/g, '<br>');
        $('#aiText').html(
            (this.currentConversationId ? $('#aiText').html() + '<br><br>--------------------<br><br>' : '') +
            formattedContent
        );

        
        $('html, body').animate({
            scrollTop: $('#aiText').offset().top
        }, 500);

        
        $('#aiText').focus();
    }
    
    updateConversationStatus(messageCount) {
        if (messageCount) {
            const statusHtml = `<div class="text-muted small mt-2">Conversation messages: ${messageCount}</div>`;
            $('.aiChatReponse').first().find('.aiChatReponseContent').after(statusHtml);
        }
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
    @apply lg:h-[75vh];
  }

  @screen lg {
    .messages-container {
      height: calc(75vh - 8rem);
      
    }
  }

  
  #calendarContainer {
    @apply w-full overflow-x-auto pb-4 -mx-4 px-4;
    @apply lg:mx-0 lg:px-0;
  }

  .calendar {
    @apply min-w-[800px] w-full border-collapse;
  }

  .calendar th {
    @apply p-2 text-center border border-base-300 bg-base-300;
  }

  .calendar td {
    @apply p-2 border border-base-300 align-top bg-base-100;
    @apply transition-colors hover:bg-base-300/30;
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
