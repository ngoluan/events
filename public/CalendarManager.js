// Import Moment Timezone if using modules
// import moment from 'moment-timezone';

export class CalendarManager {
    constructor(eventManageApp) {
        this.eventManageApp = eventManageApp; // Reference to the main app
        this.calendarEvents = [];
        this.mainCalendar = null;
        this.timezone = 'America/New_York'; // Define your timezone here or make it configurable
    }

    async initializeCalendar() {
        try {
            const data = await $.get("/calendar/getEventCalendar");

            // Create a map of contacts by date for faster lookup
            const contactsByDate = {};
            this.eventManageApp.contacts.getContacts().forEach(contact => {
                if (contact.startTime && contact.name) {
                    const contactDate = moment.tz(contact.startTime, this.timezone).format('YYYY-MM-DD');
                    if (!contactsByDate[contactDate]) {
                        contactsByDate[contactDate] = [];
                    }
                    contactsByDate[contactDate].push({
                        name: contact.name.toLowerCase(),
                        attendance: contact.attendance
                    });
                }
            });

            // Transform calendar events
            this.calendarEvents = data.map((event, index) => {
                const startTime = moment.tz(event.start.dateTime || event.start.date, this.timezone);
                const endTime = moment.tz(event.end.dateTime || event.end.date, this.timezone);
                const eventDate = startTime.format('YYYY-MM-DD');
                const eventName = event.summary.toLowerCase();

                // Find matching contact
                let matchingContact = null;
                const contactsOnDate = contactsByDate[eventDate] || [];
                for (const contact of contactsOnDate) {
                    if (eventName.includes(contact.name)) {
                        matchingContact = contact;
                        break;
                    }
                }

                // Add attendance to summary if available
                const attendanceInfo = matchingContact?.attendance ? ` (${matchingContact.attendance} ppl)` : '';
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
                    attendance: matchingContact?.attendance
                };
            });

            // Initialize the calendar
            this.mainCalendar = new Calendar('calendar');
            this.mainCalendar.loadEvents(this.calendarEvents);

            // Refresh contacts display using the Contacts class method
            if (this.eventManageApp.contacts.getContacts().length > 0) {
                this.eventManageApp.contacts.renderContactsWithCalendarSync();
            }

        } catch (error) {
            console.error('Error loading calendar events:', error);
            this.eventManageApp.showToast('Failed to load calendar events', 'error');
        }
    }

    async refreshSync() {
        try {
            await this.initializeCalendar();
            this.eventManageApp.showToast("Calendar sync refreshed", "success");
        } catch (error) {
            console.error('Error refreshing calendar sync:', error);
            this.eventManageApp.showToast("Failed to refresh calendar sync", "error");
        }
    }

    initializeMaximizeButtons() {
        // For AI Result maximize button
        $('#maximizeAiResult').on('click', (e) => {
            e.preventDefault();
            const content = $('#aiResult').html();
            $('#maximizeModalTitle').text('AI Conversation');
            $('#maximizedContent').html(content);
            document.getElementById('maximize_content_modal').showModal();
        });
        // For AI Text maximize button
        $('#toggleButton').off('click').on('click', (e) => {
            e.preventDefault();
            const content = $('#aiText').html();
            $('#maximizeModalTitle').text('Message');
            $('#maximizedContent').attr('contenteditable', 'true').html(content);
            document.getElementById('maximize_content_modal').showModal();

            // Sync content back to aiText when editing in modal
            $('#maximizedContent').off('input').on('input', function () {
                $('#aiText').html($(this).html());
            });
        });
    }
    async createBooking() {
        if (this.eventManageApp.contacts.currentId === -1) {
            this.eventManageApp.showToast("Error: No contact selected.", "error");
            return;
        }
    
        const contact = this.eventManageApp.contacts.getContactById(this.eventManageApp.contacts.currentId);
        if (!contact) {
            this.eventManageApp.showToast("Error: Contact not found.", "error");
            return;
        }
    
        try {
            // Create the calendar event
            await this.openGoogleCalendar(contact);
    
            // Update contact status
            if (typeof contact.status === 'string') {
                contact.status = contact.status.split(';');
            } else if (!Array.isArray(contact.status)) {
                contact.status = [];
            }
    
            if (!contact.status.includes("reserved")) {
                contact.status.push("reserved");
            }
    
            // Save the updated contact
            this.eventManageApp.contacts.saveContactInfo();
    
            // Refresh calendar events via CalendarManager
            await this.initializeCalendar();
    
            this.eventManageApp.showToast("Booking created successfully", "success");
    
            // Ask about sending confirmation email
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
    TacoTaco Events Team
                `.trim();
    
                try {
                    await $.post("/gmail/sendEmail", {
                        html: emailBody.replace(/\n/g, '<br>'),
                        to: contact.email,
                        subject: emailSubject
                    });
                    this.eventManageApp.showToast("Confirmation email sent successfully", "success");
                } catch (error) {
                    console.error("Failed to send confirmation email:", error);
                    this.eventManageApp.showToast("Failed to send confirmation email", "error");
                }
            }
    
        } catch (error) {
            console.error('Error creating booking:', error);
            this.eventManageApp.showToast("Failed to create booking", "error");
        }
    }
    
    openGoogleCalendar(contact) {
        const timezone = this.timezone;
    
        const startMoment = moment.tz(contact.startTime, "YYYY-MM-DD HH:mm", timezone);
        const endMoment = moment.tz(contact.endTime, "YYYY-MM-DD HH:mm", timezone);
    
        const startDateUTC = startMoment.clone().utc().format("YYYYMMDDTHHmmss") + "Z";
        const endDateUTC = endMoment.clone().utc().format("YYYYMMDDTHHmmss") + "Z";
    
        const title = `${contact.name} (${contact.room.join(", ")})`;
        const details = `${contact.notes} - Email: ${contact.email}`;
    
        const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startDateUTC}/${endDateUTC}&details=${encodeURIComponent(details)}`;
    
        window.open(googleCalendarUrl, '_blank');
    }
}
