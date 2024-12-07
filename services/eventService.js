// eventService.js
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
    this.remoteApiGetUrl = 'https://eattaco.ca/api/getEventsContacts';
    this.remoteApiUpdateUrl = 'https://eattaco.ca/api/updateEventContact';
    this.calendarService = new GoogleCalendarService(googleAuth);

    // Initialize without gmail service
    this.gmailService = null;

    this.initializeEventsFile();
  }

  // Add method to set Gmail service
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
      // Get the contact information
      const contact = this.getEvent(id);
      if (!contact) {
        throw new Error('Event not found');
      }

      // Get all emails for this contact
      const emails = await this.gmailService.getEmailsForContact(contact.email);

      // Sort emails by date
      const sortedEmails = emails.sort((a, b) =>
        new Date(a.internalDate) - new Date(b.internalDate)
      );

      // Get the first email's content
      const firstEmail = sortedEmails[0];
      const emailContent = firstEmail?.text || firstEmail?.html || '';
      const cleanedemailContent = Utils.cleanEmailContent(emailContent);

      // Format contact data for the prompt
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
        createdAt: contact.createdAt || ''  // In case this is available
    };
      // Prepare the prompt for AI
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

      // Get AI summary
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
      // Fetch remote events
      const response = await axios.get(this.remoteApiGetUrl);
      const remoteEvents = response.data;

      // Load local events
      let localEvents = this.loadEvents();

      // Create a map of existing local events by ID
      const localEventsMap = new Map(localEvents.map(event => [event.id, event]));

      // Merge remote events with local events
      remoteEvents.forEach(remoteEvent => {
        const existingEvent = localEventsMap.get(remoteEvent.id);

        if (existingEvent) {
          // If event exists locally, update only if remote version is newer
          // You might want to add a lastModified field to properly handle this
          localEventsMap.set(remoteEvent.id, { ...existingEvent, ...remoteEvent });
        } else {
          // If event doesn't exist locally, add it
          localEventsMap.set(remoteEvent.id, remoteEvent);
        }
      });

      // Convert map back to array and save
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
      // If events is an array, wrap it in an object
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

      // Check if ID is provided and unique
      let newId;
      if (eventData.id !== undefined && eventData.id !== null) {
        newId = parseInt(eventData.id);
        const existingEvent = events.find(event => event.id === newId);
        if (existingEvent) {
          throw new Error('Event with this ID already exists');
        }
      } else {
        // Generate new ID if not provided
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
        // Event not found, create new event with the given ID
        const newEvent = { ...eventData, id: parseInt(id) };
        events.push(newEvent);
        this.saveEvents(events);
        return newEvent;
      }

      // Update existing event
      events[index] = {
        ...events[index],
        ...eventData,
        id: parseInt(id), // Ensure the ID remains consistent
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
      // Get calendar events using the route
      const calendarEvents = await this.calendarService.listEvents();

      // Load local events
      const localEvents = this.loadEvents();

      // Filter events for next week
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

      // Process each event
      for (const event of upcomingEvents) {
        const eventName = event.summary || 'Unnamed Event';
        const eventStart = moment(event.start.dateTime || event.start.date);
        const eventStartFormatted = eventStart.format('MMMM Do YYYY, h:mm a');
        const eventStartDate = eventStart.format('YYYY-MM-DD');

        // Find matching local event
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
            // Get event summary using the existing endpoint
            const summaryResponse = await axios.get(`${process.env.HOST}/api/events/${localEvent.id}/summary`);
            eventDetails = summaryResponse.data.summary;

            // Determine catering status
            cateringStatus = localEvent.services &&
              Array.isArray(localEvent.services) &&
              localEvent.services.includes('catering')
              ? 'Requested' : 'Not Requested';

            // Generate follow-up email content using AI
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


            // Create mailto link with AI-generated content
            const subject = `Excited for your event on ${eventStart.format('MMMM Do')}`;

            // Properly encode the components separately
            const encodedEmail = encodeURIComponent(localEvent.email);
            const encodedSubject = encodeURIComponent(subject);
            const encodedBody = encodeURIComponent(emailContent);

            // Create the mailto link without URLSearchParams
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

      // Generate email HTML
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

      // Send email using the gmail service
      await this.gmailService.sendEmail('info@eattaco.ca', emailData.subject, emailData.html);

      return emailData;
    } catch (error) {
      console.error('Error generating weekly summary:', error);
      throw error;
    }
  }
}

module.exports = EventService;