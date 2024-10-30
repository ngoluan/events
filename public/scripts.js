// Ensure Moment Timezone is imported if using modules
// import moment from 'moment-timezone';

export class EventManageApp {
    constructor() {
        // General properties
        this.mainCalendar = null;
        this.contacts = [];
        this.currentId = -1;

        // AI-related properties
        this.templates = {};
        this.userEmail = ''; // To store the authenticated user's email

    }

    async init() {
        // Initialize utilities
        this.sounds = {
            orderUp: new Howl({ src: ['./orderup.m4a'] })
        };

        // Load AI templates
        await this.loadTemplates();

        // Set up event listeners
        this.registerEvents();

        // Load initial data
        this.getAllContacts();
        this.createCalendar();
        this.readGmail("all", false);

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('oauth') === 'success') {
            // Fetch the connected email from the backend
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

        // Alert on new SMS received

    }

    /*** AI-Related Methods ***/

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

    /*** Event Registration ***/

    registerEvents() {
        // AI-related events
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

        // Other events
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


        // Initiate Google OAuth
        $('#googleOAuthButton').on('click', () => {
            this.initiateGoogleOAuth();
        });

        // Logout
        $('#logoutButton').on('click', () => {
            this.logout();
        });
        // Place additional event handlers here, grouped logically
        // For example, handlers related to email actions
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

        // Other event handlers can be added here
    }


    /*** Helper Methods ***/

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

    /*** Data Loading Methods ***/


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

        // Populate form fields
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

    /*** Calendar Methods ***/

    async createCalendar() {
        this.mainCalendar = new Calendar('calendar');
        try {
            const data = await $.get("/calendar/getEventCalendar");

            // Process the events data
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

    /*** Contact Methods ***/

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

    /*** Contract Methods ***/

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
                window.open(`/files/EventContract_${data.reservationDate.replace(/\//g, "")}_${data.contactName.replace(/ /g, "")}.pdf`, "_blank");
            }
        });
    }

    /*** Summarize Emails ***/

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
