
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
        
        <div class=" lg:flex fixed top-4 right-4 gap-2 z-50">
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
                    
                    <section id="messages" class="card bg-base-100 shadow-lg">
                        <div class="card-body">
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
            <section id="calendar" class="card bg-base-100 shadow-lg ">
                <div class="card-body">
                    <h2 class="card-title text-lg mb-4">Calendar</h2>
                    <div id="calendarContainer" class="w-full">
                        
                    </div>
                </div>
            </section>
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

//--- File: /home/luan_ngo/web/events/public/calendar.js ---
class Calendar {
    constructor(containerId) {
        this.containerId = containerId;
        this.currentDate = new Date();
        this.events = [];
        this.weatherData = new Map();
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
    getWMOIcon(code) {
        
        const weatherCodes = {
            0: { icon: 'bi-sun-fill', class: 'text-yellow-500' },  
            1: { icon: 'bi-sun-fill', class: 'text-yellow-500' },  
            2: { icon: 'bi-cloud-sun-fill', class: 'text-gray-500' },  
            3: { icon: 'bi-cloud-fill', class: 'text-gray-500' },  

            
            45: { icon: 'bi-cloud-haze-fill', class: 'text-gray-400' },  
            48: { icon: 'bi-cloud-haze-fill', class: 'text-gray-400' },  

            
            51: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },  
            53: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },  
            55: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },  

            
            56: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  
            57: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  

            
            61: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  
            63: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  
            65: { icon: 'bi-cloud-rain-heavy-fill', class: 'text-blue-600' },  

            
            66: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  
            67: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  

            
            71: { icon: 'bi-snow', class: 'text-blue-200' },  
            73: { icon: 'bi-snow', class: 'text-blue-200' },  
            75: { icon: 'bi-snow-fill', class: 'text-blue-200' },  

            
            77: { icon: 'bi-snow', class: 'text-blue-200' },  

            
            80: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  
            81: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  
            82: { icon: 'bi-cloud-rain-heavy-fill', class: 'text-blue-600' },  

            
            85: { icon: 'bi-snow', class: 'text-blue-200' },  
            86: { icon: 'bi-snow-fill', class: 'text-blue-200' },  

            
            95: { icon: 'bi-cloud-lightning-fill', class: 'text-yellow-600' },  
            96: { icon: 'bi-cloud-lightning-rain-fill', class: 'text-yellow-600' },  
            99: { icon: 'bi-cloud-lightning-rain-fill', class: 'text-yellow-600' }   
        };

        return weatherCodes[code] || { icon: 'bi-question-circle', class: 'text-gray-500' };
    }

    async fetchWeatherData() {
        try {
            const response = await fetch('https:
            const data = await response.json();

            
            data.daily.time.forEach((date, index) => {
                this.weatherData.set(date, {
                    weatherCode: data.daily.weather_code[index],
                    maxTemp: Math.round(data.daily.temperature_2m_max[index]),
                    minTemp: Math.round(data.daily.temperature_2m_min[index])
                });
            });
        } catch (error) {
            console.error('Error fetching weather data:', error);
        }
    }

    generateCalendar(d) {
        const firstDayOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
        const totalDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        let html = '<table class="table calendar"><thead><tr>';

        for (let i = 0; i < 7; i++) {
            html += `<th>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}</th>`;
        }
        html += '</tr></thead><tbody><tr>';

        
        for (let i = 0; i < firstDayOfMonth; i++) {
            html += '<td></td>';
        }

        for (let day = 1; day <= totalDays; day++) {
            const dayDate = new Date(d.getFullYear(), d.getMonth(), day);
            const dateStr = moment(dayDate).format('YYYY-MM-DD');
            const weather = this.weatherData.get(dateStr);

            if ((day + firstDayOfMonth - 1) % 7 === 0 && day > 1) {
                html += '</tr><tr>';
            }

            html += `
                <td class="day relative" data-date="${dateStr}">
                    <div class="flex justify-between items-start">
                        <span class="font-bold">${day}</span>
                        ${weather ? `
                            <div class="weather-info text-xs flex flex-col items-end">
                                <div class="flex items-center gap-1">
                                    <i class="bi ${this.getWMOIcon(weather.weatherCode).icon} ${this.getWMOIcon(weather.weatherCode).class}"></i>
                                </div>
                                <div class="text-right">
                                    <span class="text-red-500">${weather.maxTemp}°</span>
                                    <span class="text-blue-500">${weather.minTemp}°</span>
                                </div>
                            </div>
                        ` : ''}
                    </div>`;

            
            const eventsForDay = this.events.filter(event => {
                const eventStart = new Date(event.startTime).setHours(0, 0, 0, 0);
                const eventEnd = new Date(event.endTime).setHours(23, 59, 59, 999);
                return dayDate >= eventStart && dayDate <= eventEnd;
            });

            eventsForDay.forEach(event => {
                html += `
                    <div class="event-bar mt-2" data-eventid="${event.id}" title="${event.title}">
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

    async changeMonth(offset) {
        this.currentDate.setMonth(this.currentDate.getMonth() + offset);
        await this.fetchWeatherData(); 
        this.refreshCalendar();
    }

    async initialize() {
        await this.fetchWeatherData();
        this.constructHTML();
        this.refreshCalendar();
    }
}








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
    const surcharge = this.ccSurcharge ? subtotalWithTipAndTax * 0.024 : 0;
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

//--- File: /home/luan_ngo/web/events/public/EmailEventUpdater.js ---
class EmailEventUpdater {
    constructor(app) {
        this.app = app;
        this.highlightedFields = new Set();
    }

    async updateEventFromEmail(emailContent, emailAddress) {
        try {
            
            const event = this.app.contacts.find(contact => 
                contact.email && contact.email.toLowerCase() === emailAddress.toLowerCase()
            );

            if (!event) {
                this.app.showToast('No matching event found for this email', 'error');
                return;
            }

            
            this.app.loadContact(event.id);

            
            const response = await fetch('/ai/analyzeEventUpdate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventDetails: event,
                    emailContent: emailContent
                })
            });

            if (!response.ok) {
                throw new Error('Failed to analyze event update');
            }

            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to analyze event update');
            }

            
            const timestamp = moment().format('MM/DD/YYYY HH:mm');
            const updatedNotes = `[${timestamp}] Update from email:\n${result.summary}\n\n${event.notes || ''}`;
            
            
            event.notes = updatedNotes;
            
            
            const updatedFields = new Set(['notes']);
            this.updateUI(event, updatedFields);

            
            

            
            

            return true;
        } catch (error) {
            console.error('Error updating event from email:', error);
            this.app.showToast('Failed to update event information', 'error');
            return false;
        }
    }

    updateUI(event, updatedFields) {
        
        this.clearHighlights();
        this.highlightedFields = updatedFields;

        
        updatedFields.forEach(field => {
            const element = document.getElementById(`info${field.charAt(0).toUpperCase() + field.slice(1)}`);
            if (element) {
                
                if (field === 'notes') {
                    element.value = event.notes;
                } else {
                    element.value = event[field];
                }

                
                const label = element.previousElementSibling;
                if (label && label.classList.contains('label')) {
                    label.style.backgroundColor = '#fff3cd';
                }
            }
        });

        
        const saveButton = document.getElementById('infoSave');
        if (saveButton) {
            const originalClick = saveButton.onclick;
            saveButton.onclick = (e) => {
                if (originalClick) originalClick(e);
                this.clearHighlights();
            };
        }
    }

    clearHighlights() {
        this.highlightedFields.forEach(field => {
            const element = document.getElementById(`info${field.charAt(0).toUpperCase() + field.slice(1)}`);
            if (element) {
                const label = element.previousElementSibling;
                if (label && label.classList.contains('label')) {
                    label.style.backgroundColor = '';
                }
            }
        });
        this.highlightedFields.clear();
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
    @apply flex-1 overflow-y-auto overflow-x-hidden space-y-4;
    min-height: 100px;
    padding: 1rem;
  }

  #messages, #actionss {
    @apply flex flex-col h-full;
    height: 75vh;
  }

  #messages .card-body {
    @apply p-4;
  }

  #messages .card-title {
    @apply mb-4 flex justify-between items-center;
  }

  
  .sms {
    @apply bg-white border border-gray-200 rounded-lg transition-all duration-200 p-4;
  }

  .toggle-button {
    @apply inline-flex items-center justify-center w-8 h-8 rounded-full 
           hover:bg-gray-100 transition-colors text-gray-600 hover:text-gray-800;
  }

  .email {
    @apply transition-all duration-200 overflow-hidden;
    max-height: 25vh;
  }

  .email.expanded {
    max-height: none;
  }

  .email-header {
    @apply mb-3 text-sm text-gray-600 space-y-1;
  }

  .email-body {
    @apply text-gray-800 whitespace-pre-line mt-4;
  }



  
  .email-filters {
    @apply flex items-center gap-4 mb-4 px-4 py-2 bg-gray-50 rounded-lg;
  }

  .toggle {
    @apply relative inline-flex h-6 w-11 items-center rounded-full transition-colors;
  }

  .toggle-primary {
    @apply bg-gray-200;
  }

  .toggle-primary:checked {
    @apply bg-primary;
  }

  
  .email-icons {
    @apply flex items-center gap-2 mb-2;
  }

  .status-icon {
    @apply inline-flex items-center justify-center w-6 h-6 rounded-full;
  }

  .unread-icon {
    @apply text-warning;
  }

  .important-icon {
    @apply text-danger;
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

  
  .custom-scrollbar::-webkit-scrollbar {
    @apply w-2;
  }

  .custom-scrollbar::-webkit-scrollbar-track {
    @apply bg-base-100;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb {
    @apply bg-base-300 rounded-full hover:bg-base-300/70;
  }

  
  .fade-in {
    animation: fadeIn 0.3s ease-in-out;
  }

  .slide-in {
    animation: slideIn 0.3s ease-in-out;
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


.hover-lift {
  @apply transition-transform duration-200 hover:-translate-y-0.5;
}

.icon-btn {
  @apply inline-flex items-center justify-center w-8 h-8 rounded-full;
  @apply hover:bg-gray-100 transition-colors text-gray-600 hover:text-gray-800;
}
