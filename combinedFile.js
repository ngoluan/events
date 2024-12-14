
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
      console.log('Starting weekly summary generation');

      
      console.log('Fetching calendar events...');
      const calendarEvents = await this.calendarService.listEvents();
      console.log(`Retrieved ${calendarEvents.length} calendar events`);

      
      console.log('Loading local events...');
      const localEvents = this.loadEvents();
      console.log(`Loaded ${localEvents.length} local events`);

      
      console.log('Filtering events for next week...');
      const startOfWeek = moment().tz('America/New_York').startOf('day').add(1, 'day');
      const endOfWeek = moment().tz('America/New_York').add(7, 'days').endOf('day');

      const upcomingEvents = calendarEvents.filter(event => {
        const eventStart = moment(event.start.dateTime || event.start.date);
        return eventStart.isBetween(startOfWeek, endOfWeek);
      });
      console.log(`Found ${upcomingEvents.length} upcoming events for next week`);

      if (upcomingEvents.length === 0) {
        console.log('No upcoming events found, sending empty summary email');
        const noEventsEmail = {
          subject: 'Weekly Event Summary - No Upcoming Events',
          html: 'No events scheduled for the upcoming week.'
        };

        await this.gmailService.sendEmail('info@eattaco.ca', noEventsEmail.subject, noEventsEmail.html);
        return noEventsEmail;
      }

      let eventSummaries = [];

      
      console.log('Processing individual events...');
      for (const event of upcomingEvents) {
        console.log(`\nProcessing event: ${event.summary || 'Unnamed Event'}`);
        const eventName = event.summary || 'Unnamed Event';
        const eventStart = moment(event.start.dateTime || event.start.date);
        const eventStartFormatted = eventStart.format('MMMM Do YYYY, h:mm a');
        const eventStartDate = eventStart.format('YYYY-MM-DD');

        
        console.log('Looking for matching local event...');
        const localEvent = localEvents.find(e => {
          if (typeof e.name === 'undefined') return false;
          const localEventName = e.name.toLowerCase();
          const localEventDate = moment(e.startTime).format('YYYY-MM-DD');
          return eventName.toLowerCase().includes(localEventName) &&
            localEventDate === eventStartDate;
        });

        if (localEvent) {
          console.log(`Found matching local event with ID: ${localEvent.id}`);
        } else {
          console.log('No matching local event found');
        }

        let eventDetails = 'Event found in calendar but no matching contact details in system.';
        let cateringStatus = 'Unknown';
        let followUpMailto = '';

        if (localEvent) {
          try {
            console.log('Fetching event summary...');
            const summaryResponse = await axios.get(`${process.env.HOST}/api/events/${localEvent.id}/summary`);
            eventDetails = summaryResponse.data.summary;

            
            cateringStatus = localEvent.services &&
              Array.isArray(localEvent.services) &&
              localEvent.services.includes('catering')
              ? 'Requested' : 'Not Requested';
            console.log(`Catering status: ${cateringStatus}`);

            
            console.log('Generating follow-up email content...');
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
              resetHistory: true
            });
            console.log('Follow-up email content generated successfully');

            
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

      
      console.log('Generating email HTML...');
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

      
      console.log('Sending weekly summary email...');
      await this.gmailService.sendEmail('info@eattaco.ca', emailData.subject, emailData.html);
      console.log('Weekly summary email sent successfully');

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

//--- File: /home/luan_ngo/web/events/public/scripts.js ---


import { CalendarManager } from './CalendarManager.js'; 
import { UserSettings } from './UserSettings.js';
export class EventManageApp {
    constructor() {
        this.emailProcessor = new EmailProcessor(this);
        this.contacts = new Contacts(this);
        const showImportantSetting = localStorage.getItem('showImportantEmails');
        this.emailFilters = {
            showImportant: showImportantSetting === null ? false : showImportantSetting === 'true'
        };
        this.emailEventUpdater = new EmailEventUpdater(this);
        this.initializeToastContainer();
        this.calendarManager = new CalendarManager(this);
        this.userSettings = new UserSettings(this);
    }

    async init() {
        await this.loadTemplates();
        await this.contacts.getAllContacts();
        await this.contacts.initializeFuse();
        await this.userSettings.initializeSettings();

        this.contacts.renderContactsWithCalendarSync();
        await this.calendarManager.initializeCalendar();
        this.emailProcessor.loadInitialEmails();
        this.calendarManager.initializeMaximizeButtons();

        this.registerEvents();
        this.contacts.registerEvents();

        fetch(`/ai/resetHistory`);

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('oauth') === 'success') {
            const response = await $.get('/api/getConnectedEmail');
            if (response.email) {
                this.userSettings.setConnectedEmail(response.email);
            }
        }

        $(document).on('eventDetailsReceived', async (e, eventDetails) => {
            const lastId = this.contacts.getContacts().length > 0
                ? this.contacts.getContacts()[this.contacts.getContacts().length - 1].id
                : 0;
            eventDetails.id = lastId + 1;
            this.contacts.addContact(eventDetails);
            this.contacts.loadContact(eventDetails.id);
        });

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
        if (this.contacts.currentId === -1) {
            this.showToast("Error: No contact selected.", "error");
            return;
        }

        const contact = this.contacts.getContactById(this.contacts.currentId);
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
            toastContainer.className = 'fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2';
            document.body.appendChild(toastContainer);
        }
    }
    showToast(message, type = 'info') {
        const toast = document.createElement('div');

        
        toast.className = 'alert transform translate-x-full transition-all duration-300 ease-in-out shadow-lg max-w-sm';

        
        switch (type) {
            case 'success':
                toast.className += ' alert-success';
                toast.innerHTML = `
                    <div>
                        <i class="bi bi-check-circle-fill"></i>
                        <span>${message}</span>
                    </div>
                `;
                break;
            case 'error':
                toast.className += ' alert-error';
                toast.innerHTML = `
                    <div>
                        <i class="bi bi-x-circle-fill"></i>
                        <span>${message}</span>
                    </div>
                `;
                break;
            case 'warning':
                toast.className += ' alert-warning';
                toast.innerHTML = `
                    <div>
                        <i class="bi bi-exclamation-triangle-fill"></i>
                        <span>${message}</span>
                    </div>
                `;
                break;
            default:
                toast.className += ' alert-info';
                toast.innerHTML = `
                    <div>
                        <i class="bi bi-info-circle-fill"></i>
                        <span>${message}</span>
                    </div>
                `;
        }

        
        const closeButton = document.createElement('button');
        closeButton.className = 'btn btn-ghost btn-sm btn-square absolute right-2';
        closeButton.innerHTML = '<i class="bi bi-x text-lg"></i>';
        closeButton.onclick = () => removeToast(toast);
        toast.appendChild(closeButton);

        
        const container = document.getElementById('toast-container');
        container.appendChild(toast);

        
        requestAnimationFrame(() => {
            toast.classList.remove('translate-x-full');
            toast.classList.add('translate-x-0');
        });

        
        const timeout = setTimeout(() => removeToast(toast), 3000);

        function removeToast(toastElement) {
            clearTimeout(timeout);
            toastElement.classList.remove('translate-x-0');
            toastElement.classList.add('translate-x-full');

            
            setTimeout(() => {
                if (toastElement.parentElement) {
                    toastElement.remove();
                }
            }, 300);
        }
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
    cleanEmailContent(emailContent) {
        if (!emailContent) return '';

        return emailContent
            
            .replace(/TacoTaco Events Team\s*\(\d{3}\)\s*\d{3}-\d{4}\s*\|\s*info@eattaco\.ca\s*eattaco\.ca/g, '')
            .replace(/Founder and Director[\s\S]*?@drdinakulik/g, '')

            
            .replace(/\[https?:\/\/[^\]]+\]/g, '')
            .replace(/<(?![\w.@-]+>)[^>]+>/g, '')  

            
            .replace(/\s*Get Outlook for iOS\s*/, '')
            .replace(/\s*Learn why this is important\s*/, '')
            .replace(/\s*You don't often get email from.*?\s*/g, '')

            
            .replace(/[\t ]+/g, ' ')           
            .replace(/\n\s*\n\s*\n/g, '\n\n')  
            .replace(/^\s+|\s+$/gm, '')        
            .replace(/________________________________/g, '\n---\n') 

            
            .replace(/^[>\s>>>>>]+(?=\S)/gm, '') 

            
            .replace(/[\r\n]+/g, '\n')         
            .trim();
    }
    async sendAIRequest(endpoint, data) {
        try {
            if (data.includeBackground) {
                data.backgroundInfo = this.userSettings.getBackgroundInfo();
            }
            const response = await $.post(endpoint, data);
            return response;
        } catch (error) {
            console.error(`Failed to send AI request to ${endpoint}:`, error);
            throw error;
        }
    }
    async getEventDetailsFromEmail(text, email) {
        text = this.cleanEmailContent(text);
        text = this.templates.eventPrompt + text;

        try {
            const data = await this.sendAIRequest("/api/sendAIEventInformation", { aiText: text });
            const jsonData = data;

            const contactsArray = this.contacts.getContacts();
            const lastId = contactsArray.length > 0 ? contactsArray[contactsArray.length - 1].id : 0;
            jsonData.id = lastId + 1;
            jsonData.name = jsonData.name || "";

            
            this.contacts.addContact(jsonData);

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

    async summarizeEventAiHandler() {
        if (this.contacts.currentId === -1) {
            this.showToast('No contact selected.', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/events/${this.contacts.currentId}/summary`);
            if (!response.ok) {
                throw new Error(response.statusText);
            }

            const data = await response.json();
            console.log(data)
            
            const formattedResult = `${data.summary}.`;

            this.writeToAIResult(formattedResult);

            
            this.contacts.loadContact(this.contacts.currentId);

        } catch (error) {
            console.error('Error summarizing event:', error);
            this.showToast('Failed to summarize event', 'error');
            this.writeToAIResult('Failed to generate summary. Please try again.');
        }
    }

    registerEvents() {
        let me = this;
        $(document).on("click", "#actionsCreateContract", (e) => {
            e.preventDefault();
            this.createContract();
        });
        
        $('#viewAiLogic').on('click', () => {
            this.loadAndDisplayConversations();
        });
        $('#getInterac').on('click', (e) => {
            e.preventDefault();
            this.getInteracEmails();
        });
        $(document).on("click", "#refreshCalendarSync", (e) => {
            e.preventDefault();
            this.calendarManager.refreshSync();
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

        $('#clearAiText').on('click', (e) => {
            e.preventDefault();
            $("#aiText").html('');
            this.showToast("Message cleared", "success");
        });
        $("#receipt").on("click", (e) => {
            e.preventDefault();
            this.showReceiptManager();
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
            this.calendarManager.createBooking();
        });

        $('#googleOAuthButton').on('click', () => {
            this.userSettings.initiateGoogleOAuth();
        });
        $('#logoutButton').on('click', () => {
            this.userSettings.logout();
        });

        $('#saveBackgroundInfo').on('click', async () => {
            await this.userSettings.saveSettings();
        });


        $(document).on("click", "#calcRate", (e) => {
            e.preventDefault();
            this.calculateRate();
        });

        $(document).on("click", ".sendToAiFromResult", (e) => {
            e.preventDefault();
            this.sendToAiFromResult(e);
        });
    }

    extractEmail() {
        const aiText = $("#aiText").text();
        const regex = /From:.*?([\s\S]*?)(?=From:|$)/;
        const match = regex.exec(aiText);
        return { match, aiText };
    }


    async handleGetEventDetailsFromEvent(text, email) {
        const newId = await this.getEventDetailsFromEmail(text, email);
        this.contacts.loadContact(newId);
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

    initializeTooltips() {
        
        $('.icon-btn[data-tooltip]').tooltip('dispose');

        
        $('.icon-btn').tooltip({
            placement: 'top',
            trigger: 'hover'
        });
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

    async syncEvents() {
        try {
            await this.calendarManager.refreshSync();
            
            await this.contacts.getAllContacts();
        } catch (error) {
            console.error('Error syncing events:', error);
            this.showToast('Failed to sync events', 'error');
        }
    }
    async actionsEmailContract() {
        if (this.contacts.currentId === -1) {
            alert("Error: No contact selected.");
            return;
        }
        const contact = this.contacts.getContactById(this.contacts.currentId);
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
    createContract() {
        if (this.contacts.currentId === -1) {
            alert("Error: No contact selected.");
            return;
        }
        const contact = this.contacts.getContactById(this.contacts.currentId);
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
    async loadAndDisplayConversations() {
        try {
            const response = await fetch('/ai/conversations');
            const conversations = await response.json();

            const formattedHtml = conversations.map(msg => `
                <div class="border border-base-300 rounded-lg p-4 bg-base-100 mb-4">
                    <div class="flex justify-between items-start mb-2">
                        <span class="badge badge-primary">${msg.role}</span>
                        <div class="text-xs text-base-content/70">
                            ${new Date(msg.timestamp).toLocaleString()}
                        </div>
                    </div>
                    <div class="prose max-w-none">
                        ${this.formatConversationContent(msg.content)}
                    </div>
                    ${msg.provider && msg.model ? `
                        <div class="mt-2 flex gap-2">
                            <span class="badge badge-ghost">${msg.provider}</span>
                            <span class="badge badge-ghost">${msg.model}</span>
                        </div>
                    ` : ''}
                </div>
            `).join('');

            document.getElementById('aiLogicContent').innerHTML = formattedHtml;
            window.ai_logic_modal.showModal();

        } catch (error) {
            console.error('Error loading conversations:', error);
            document.getElementById('aiLogicContent').innerHTML = `
                <div class="alert alert-error">
                    <i class="bi bi-exclamation-triangle"></i>
                    <span>Failed to load conversations</span>
                </div>
            `;
        }
    }
    formatConversationContent(content) {
        if (typeof content === 'object') {
            return `<pre class="bg-base-200 p-4 rounded-lg overflow-x-auto">${JSON.stringify(content, null, 2)}</pre>`;
        }

        return content
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .split('\n')
            .map(line => `<p class="${line.trim() === '' ? 'h-4' : ''}">${line}</p>`)
            .join('');
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
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    
                    <section id="messages" class="card bg-base-100 shadow-lg h-full">
                        <div class="card-body flex flex-col h-full p-6">
                            <div class="flex justify-between items-center mb-4">
                                <h2 class="card-title text-lg">Messages</h2>
                                <div class="flex gap-2">
                                    <div id="toggleRepliedEmails"></div> 

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
                                    <div class="flex gap-2">
                                        <button id="viewAiLogic" class="btn btn-ghost btn-xs btn-square tooltip"
                                            data-tip="View AI Logic">
                                            <i class="bi bi-code-slash"></i>
                                        </button>
                                        <button id="maximizeAiResult" class="btn btn-ghost btn-xs btn-square tooltip"
                                            data-tip="Maximize">
                                            <i class="bi bi-arrows-fullscreen"></i>
                                        </button>
                                    </div>
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
                                            <button
                                                class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 transition-colors"
                                                id="sendEmail">
                                                <i class="bi bi-send text-xl text-primary"></i>
                                                <span class="text-xs font-medium">Send</span>
                                            </button>
                                        </div>

                                        <div class="flex flex-col sm:flex-row gap-2">
                                            <input type="text" id="sendMailEmail" class="input input-bordered w-full"
                                                placeholder="Email">
                                            <input type="text" id="sendMailSubject" class="input input-bordered w-full"
                                                placeholder="Subject">

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
        <div class="modal-box w-11/12 max-w-4xl">
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
                    <table class="table w-full" id="emailCategoryTable">
                        <thead>
                            <tr>
                                <th>Category</th>
                                <th>Description</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            
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
    <dialog id="ai_logic_modal" class="modal">
        <div class="modal-box w-11/12 max-w-7xl h-[90vh]">
            <h3 class="font-bold text-lg mb-4">AI Logic History</h3>
            <div id="aiLogicContent" class="overflow-y-auto max-h-[calc(100%-8rem)]">
                
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
    <script src="/Contacts.js"></script>
    <script src="/EmailProcessor.js"></script>
    <script src="/ReceiptManager.js"></script>
    <script src="/calendar.js"></script>
    <script type="module">
        import { EventManageApp } from '/scripts.js';
        window.app = new EventManageApp();

        document.addEventListener('DOMContentLoaded', function () {
            window.app.init();
        });
    </script>
</body>

</html>

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
    const surcharge = this.ccSurcharge ? subtotal * 0.027 : 0;
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

//--- File: /home/luan_ngo/web/events/public/Contacts.js ---

class Contacts {
    constructor(parent) {
        if (!parent) {
            throw new Error('Contacts requires parent EventManageApp instance');
        }
        this.parent = parent;
        this.contacts = [];
        this.fuse = null;
        this.currentId = -1;
    }

    async getAllContacts() {
        try {
            const response = await fetch("/api/events");
            const contacts = await response.json();
            
            this.contacts = contacts.map(contact => ({
                ...contact,
                createdAt: contact.createdAt || new Date().toISOString()
            }));
            return this.contacts;
        } catch (error) {
            console.error("Error getting contacts:", error);
            this.parent.showToast('Failed to load contacts', 'error');
        }
    }

    getContacts() {
        return this.contacts;
    }

    getContactById(id) {
        return this.contacts.find(contact => contact.id === id);
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
                this.contacts.reverse()
                break;

            default:
                return 0;
        }

        
        this.renderContactsWithCalendarSync();
        this.parent.showToast(`Sorted by ${criteria.replace(/([A-Z])/g, ' $1').toLowerCase()}`, 'success');
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

    initializeFuse() {
        if (this.contacts.length > 0) {
            this.fuse = new Fuse(this.contacts, {
                keys: ['name'],
                threshold: 0.3
            });
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
                    const contact = this.getContactById(update.id);
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

    addContact(contact) {
        this.contacts.push(contact);

        
        this.renderContactsWithCalendarSync();
    }

    renderContactsWithCalendarSync() {
        const eventsByDate = {};
        this.parent.calendarManager.calendarEvents.forEach(event => {
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

    loadContact(id) {
        const contact = this.getContactById(id);
        if (!contact) {
            this.currentId = -1;
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
            
            this.parent.emailProcessor.readGmail(contact.email, {
                showAll: true,
                ignoreFilters: true
            });
        }
        $("#depositPw").html(this.parent.emailProcessor.calcDepositPassword(contact));
    }

    filterContacts(searchTerm) {
        const $contacts = $('#contacts .contactCont');

        if (!searchTerm) {
            $contacts.show();
            return;
        }

        $contacts.each((_, contact) => {
            const $contact = $(contact);
            const contactData = this.getContactById(parseInt($contact.data('id')));

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

    saveContactInfo() {
        let contact = this.getContactById(this.currentId);
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
                    this.parent.showToast("Contact updated", "success");
                    
                    const index = this.contacts.findIndex(c => c.id === contact.id);
                    if (index !== -1) {
                        this.contacts[index] = contact;
                    }
                },
                error: (xhr, status, error) => {
                    console.error("Failed to update contact:", error);
                    this.parent.showToast("Failed to update contact", "error");
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
                    this.parent.showToast("Contact created", "success");
                },
                error: (xhr, status, error) => {
                    console.error("Failed to create contact:", error);
                    this.parent.showToast("Failed to create contact", "error");
                }
            });
        }
    }

    registerEvents() {
        
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

        
        $(document).on("click", ".contactBtn", (e) => {
            e.preventDefault();
            $('html, body').animate({ scrollTop: $('#info').offset().top }, 500);
            this.loadContact($(e.currentTarget).parent().data("id"));
        });

        
        $(document).on("click", "#infoSave", (e) => {
            e.preventDefault();
            this.saveContactInfo();
        });
    }
}
