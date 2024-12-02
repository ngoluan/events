
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
            // Add creation time if not present
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

                // First, separate future and past events
                const futureEvents = this.contacts.filter(contact =>
                    moment(contact.startTime).isSameOrAfter(now)
                );

                const pastEvents = this.contacts.filter(contact =>
                    moment(contact.startTime).isBefore(now)
                );

                // Sort future events by closest date first
                futureEvents.sort((a, b) => {
                    const daysToA = moment(a.startTime).diff(now, 'days');
                    const daysToB = moment(b.startTime).diff(now, 'days');
                    return daysToA - daysToB;
                });

                // Sort past events by most recent
                pastEvents.sort((a, b) => {
                    const daysAgoA = moment(a.startTime).diff(now, 'days');
                    const daysAgoB = moment(b.startTime).diff(now, 'days');
                    return daysAgoB - daysAgoA; // Reverse sort for past events
                });

                // Combine the arrays with future events first
                this.contacts = [...futureEvents, ...pastEvents];
                break;

            default:
                return 0;
        }

        // Re-render the contacts list
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
                // Ensure services and room are properly formatted
                const services = Array.isArray(update.contact.services)
                    ? update.contact.services.join(';')
                    : update.contact.services;

                const room = Array.isArray(update.contact.room)
                    ? update.contact.room.join(';')
                    : update.contact.room;

                // Ensure status is properly formatted and deduplicated
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
                        contact.status = status; // Update with the deduplicated status string
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

        // Re-render contacts list to reflect the new addition
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
        // Build all HTML at once
        let html = '';
        const statusUpdates = []; // Track contacts that need status updates

        this.contacts.slice().reverse().forEach(contact => {
            if (!contact || !contact.startTime || !contact.name) return;

            const contactDate = moment.tz(contact.startTime, 'America/New_York');
            const formattedDate = contactDate.format("MM/DD/YYYY");
            const lookupDate = contactDate.format('YYYY-MM-DD');
            const contactFirstWord = contact.name.toLowerCase().split(' ')[0];

            let colour = "blue";
            let statusIcons = '';
            let hasCalendarEntry = false;

            // Check if there are any events on this date
            const eventsOnDate = eventsByDate[lookupDate] || [];
            if (eventsOnDate.length > 0) {
                hasCalendarEntry = eventsOnDate.some(event => {
                    const eventTitle = event.title || '';
                    const eventFirstWord = eventTitle.toLowerCase().split(' ')[0];
                    return eventFirstWord === contactFirstWord;
                });
            }

            // Normalize status to array
            let statusArray = [];
            if (typeof contact.status === 'string') {
                statusArray = [...new Set(contact.status.split(';').filter(s => s))]; // Remove duplicates and empty strings
            } else if (Array.isArray(contact.status)) {
                statusArray = [...new Set(contact.status.filter(s => s))]; // Remove duplicates and empty strings
            }

            // Update status based on calendar entry
            if (hasCalendarEntry) {
                statusIcons += '<i class="bi bi-calendar-check-fill text-success ml-2"></i>';

                // Add reserved status if not present
                if (!statusArray.includes("reserved")) {
                    statusArray.push("reserved");
                    // Store the full contact data for update
                    statusUpdates.push({
                        id: contact.id,
                        contact: {
                            ...contact,
                            status: statusArray // Will be joined before sending to server
                        }
                    });
                }
            } else {
                // Add status icons based on current status
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

        // Write to DOM once
        $("#contacts").empty().append(html);

        // Process status updates
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

        // Populate form fields
        $("#infoId").val(contact.id);
        $("#infoName").val(contact.name || "");
        $("#infoEmail").val(contact.email || "");
        $("#infoStartTime").val(moment.tz(contact.startTime, 'America/New_York').format("YYYY-MM-DD HH:mm"));
        $("#infoEndTime").val(moment.tz(contact.endTime, 'America/New_York').format("YYYY-MM-DD HH:mm"));

        // Handle multi-select fields
        const $statusSelect = $("#infoStatus");
        $statusSelect.val([]);  // Clear previous selections
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
            // Pass options to show all emails for this contact without filters
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

            // Search across multiple fields
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

        // Show a message if no results
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
            // If contact doesn't exist, create a new one
            contact = {};
        }

        // Get the selected values from the multi-select
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

        // Determine if we are updating or creating
        if (contact.id) {
            // Update existing contact
            $.ajax({
                url: `/api/events/${contact.id}`,
                type: 'PUT',
                data: JSON.stringify(contact),
                contentType: 'application/json',
                success: (response) => {
                    this.parent.showToast("Contact updated", "success");
                    // Update the local contacts array
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
            // Create new contact
            $.ajax({
                url: `/api/events`,
                type: 'POST',
                data: JSON.stringify(contact),
                contentType: 'application/json',
                success: (response) => {
                    // Assuming the server returns the new contact with an ID
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
        // Contact sorting
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

        // Contact search
        $('#searchInput').on('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            this.filterContacts(searchTerm);
        });

        // Contact click
        $(document).on("click", ".contactBtn", (e) => {
            e.preventDefault();
            $('html, body').animate({ scrollTop: $('#info').offset().top }, 500);
            this.loadContact($(e.currentTarget).parent().data("id"));
        });

        // Save contact info
        $(document).on("click", "#infoSave", (e) => {
            e.preventDefault();
            this.saveContactInfo();
        });
    }
}