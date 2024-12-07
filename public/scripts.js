// Ensure Moment Timezone is imported if using modules
// import moment from 'moment-timezone';
import { CalendarManager } from './CalendarManager.js'; // Adjust the path as necessary
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
                // Remove active class from all buttons
                document.querySelectorAll('.btm-nav button').forEach(btn => {
                    btn.classList.remove('active');
                });

                // Add active class to clicked button without affecting visibility
                const button = document.querySelector(`.btm-nav button[onclick*="${sectionId}"]`);
                if (button) {
                    button.classList.add('active');
                }

                // Scroll to section with offset for header
                const headerOffset = 60; // Adjust this value based on your header height
                const elementPosition = section.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        };

        // Add click handlers to all bottom nav buttons
        document.querySelectorAll('.btm-nav button').forEach(button => {
            button.addEventListener('click', function () {
                // Remove active class from all buttons
                document.querySelectorAll('.btm-nav button').forEach(btn => {
                    btn.classList.remove('active');
                });

                // Add active class to clicked button
                this.classList.add('active');
            });
        });

        // Set initial active state based on scroll position
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
        // Create a container for toasts if it doesn't exist
        if (!document.getElementById('toast-container')) {
            const toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2';
            document.body.appendChild(toastContainer);
        }
    }
    showToast(message, type = 'info') {
        const toast = document.createElement('div');

        // Set initial classes for entry animation
        toast.className = 'alert transform translate-x-full transition-all duration-300 ease-in-out shadow-lg max-w-sm';

        // Add type-specific classes and icons
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

        // Add close button
        const closeButton = document.createElement('button');
        closeButton.className = 'btn btn-ghost btn-sm btn-square absolute right-2';
        closeButton.innerHTML = '<i class="bi bi-x text-lg"></i>';
        closeButton.onclick = () => removeToast(toast);
        toast.appendChild(closeButton);

        // Add to container
        const container = document.getElementById('toast-container');
        container.appendChild(toast);

        // Trigger enter animation
        requestAnimationFrame(() => {
            toast.classList.remove('translate-x-full');
            toast.classList.add('translate-x-0');
        });

        // Auto remove after 3 seconds
        const timeout = setTimeout(() => removeToast(toast), 3000);

        function removeToast(toastElement) {
            clearTimeout(timeout);
            toastElement.classList.remove('translate-x-0');
            toastElement.classList.add('translate-x-full');

            // Remove after animation
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

    // Call this method after successful OAuth callback
    setConnectedEmail(email) {
        this.userEmail = email;
        $('#connectedEmail').text(`Connected as: ${email}`);
    }
    setupUI() {
        // Show 'readInterac' button for specific user
        if (localStorage.name === "luan") {
            $("#readInterac").removeClass("d-none");
        }

        // Handle deposit checkbox change
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
            // Remove specific signatures while preserving email chain
            .replace(/TacoTaco Events Team\s*\(\d{3}\)\s*\d{3}-\d{4}\s*\|\s*info@eattaco\.ca\s*eattaco\.ca/g, '')
            .replace(/Founder and Director[\s\S]*?@drdinakulik/g, '')

            // Remove image links while preserving email addresses in angle brackets
            .replace(/\[https?:\/\/[^\]]+\]/g, '')
            .replace(/<(?![\w.@-]+>)[^>]+>/g, '')  // Only remove HTML tags, not email addresses in brackets

            // Clean up email client specific markers while preserving the chain
            .replace(/\s*Get Outlook for iOS\s*/, '')
            .replace(/\s*Learn why this is important\s*/, '')
            .replace(/\s*You don't often get email from.*?\s*/g, '')

            // Remove excess whitespace and formatting while preserving structure
            .replace(/[\t ]+/g, ' ')           // Replace tabs and multiple spaces with single space
            .replace(/\n\s*\n\s*\n/g, '\n\n')  // Reduce multiple blank lines to double
            .replace(/^\s+|\s+$/gm, '')        // Trim start/end of each line
            .replace(/________________________________/g, '\n---\n') // Replace long underscores with simple separator

            // Clean up quoted content markers while preserving the actual content
            .replace(/^[>\s>>>>>]+(?=\S)/gm, '') // Remove leading '>' only when followed by content

            // Final whitespace cleanup
            .replace(/[\r\n]+/g, '\n')         // Normalize line endings
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

            // Use the addContact method
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
        // Replace newlines with <br> tags
        data = data.replace(/\n/g, "<br>");

        // Replace *text* with <strong>text</strong>
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
            // Simple text formatting
            const formattedResult = `${data.summary}.`;

            this.writeToAIResult(formattedResult);

            // Refresh the contact info to show updated notes
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

            // Get the HTML content and replace <br> and closing tags with newlines
            let content = container.html()
                .replace(/<br\s*\/?>/gi, '\n')  // Replace <br> tags with newlines
                .replace(/<\/p>\s*<p>/gi, '\n\n')  // Replace paragraph breaks with double newlines
                .replace(/<\/div>\s*<div>/gi, '\n')  // Replace div breaks with newlines
                .replace(/<[^>]*>/g, ''); // Remove any remaining HTML tags

            // Decode HTML entities
            content = $('<textarea>').html(content).text();

            // Trim extra whitespace while preserving intentional line breaks
            content = content.replace(/^\s+|\s+$/g, '')  // Trim start/end whitespace
                .replace(/[\t ]+\n/g, '\n')  // Remove spaces before newlines
                .replace(/\n[\t ]+/g, '\n')  // Remove spaces after newlines
                .replace(/\n\n\n+/g, '\n\n'); // Collapse multiple newlines to maximum of two

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

        // Other events
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
        // Remove any existing tooltip initialization
        $('.icon-btn[data-tooltip]').tooltip('dispose');

        // Initialize Bootstrap tooltips
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

        // Hide the status message after 3 seconds
        setTimeout(() => {
            $saveStatus.addClass('hidden');
        }, 3000);
    }

    async syncEvents() {
        try {
            await this.calendarManager.refreshSync();
            // Refresh the contacts list
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

        // Ensure contact.room is an array
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

}
