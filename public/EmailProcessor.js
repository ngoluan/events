class EmailProcessor {
    constructor(parent) {
        if (!parent) {
            throw new Error('EmailProcessor requires parent EventManageApp instance');
        }
        this.parent = parent; // Move parent initialization to top
        this.currentConversationId = null;
        this.filters = this.loadFilterState();
        this.originalEmails = [];
        this.emailFilters = {
            showImportant: localStorage.getItem('showImportantEmails') === 'true'
        };
        this.emailEventUpdater = parent.emailEventUpdater;  // Add this

        this.emailsLoaded = false;

        this.userSettings = this.initializeUserSettings();
        this.initializeEmailFilters();
        this.registerEvents(); // Move to end of initialization
    }
    async readGmail(email = null, options = {}) {
        this.adjustMessagesContainerHeight();
        $(".messages-container").html(`
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
                const type = $('#messages').data('currentView') === 'interac' ? 'interac' : 'all';
                response = await $.get("/gmail/readGmail", {
                    type: type,
                    forceRefresh: false,
                    orderBy: 'timestamp',
                    order: 'desc',
                    showImportant: this.emailFilters.showImportant
                });
            }

            if (!Array.isArray(response)) {
                throw new Error("Invalid response format");
            }

            // Store original emails before processing
            this.originalEmails = response;

            if ($('#messages').data('currentView') === 'interac') {
                this.processInteracEmails(response);
            } else {
                this.processEmails(response, options);
            }

            return response;
        } catch (error) {
            console.error("Failed to read Gmail:", error);
            $(".messages-container").html(`
                <div class="alert alert-error">
                    <i class="bi bi-exclamation-triangle"></i>
                    Failed to load emails: ${error.message || 'Unknown error'}
                </div>
            `);
            throw error;
        }
    }
    processInteracEmails(data) {
        if (!Array.isArray(data)) {
            console.error("Invalid data format:", data);
            return;
        }

        let html = '';
        data.forEach((email) => {
            // Extract Interac details using regex
            const emailContent = email.text || email.html;
            const nameMatch = emailContent.match(/Sent From:\s*(.*?)(?:\n|$)/);
            const amountMatch = emailContent.match(/Amount:\s*\$([\d.]+)/);

            const senderName = nameMatch ? nameMatch[1].trim() : 'Unknown';
            const amount = amountMatch ? amountMatch[1] : '0.00';

            // Get timestamp
            const timestamp = moment.tz(email.timestamp, 'America/New_York');
            const timeDisplay = timestamp.format("MM/DD/YYYY HH:mm");
            const timeAgo = timestamp.fromNow();

            // Find matching contacts using Fuse
            let matchingContactsHtml = '';
            const matches = this.parent.fuse ? this.parent.fuse.search(senderName) : [];
            const contact = matches.length > 0 ? matches[0].item : null;
            if (contact) {
                const depositPw = this.calcDepositPassword(contact);
                matchingContactsHtml = `
                    <div class="alert alert-success mt-2">
                        <i class="bi bi-check-circle"></i> 
                        Matching contact: ${contact.name}<br>
                        Deposit Password: ${depositPw}
                    </div>
                `;
            }

            html += `
            <div class="sms" data-id="${email.id}" data-name="${_.escape(senderName)}" data-amount="${amount}">
                <div class="flex items-center justify-between mb-2">
                    <div class="text-xl font-bold text-success">
                        $${_.escape(amount)}
                    </div>
                    <div>
                        <button class="btn btn-primary btn-sm forward-etransfer gap-2">
                            <i class="bi bi-forward"></i>
                            Forward eTransfer
                        </button>
                    </div>
                </div>

                <div class="email-header text-sm space-y-1">
                    <div><strong>From:</strong> ${_.escape(email.from)}</div>
                    <div><strong>Sent From:</strong> ${_.escape(senderName)}</div>
                    <div><strong>Time:</strong> ${timeDisplay} (${timeAgo})</div>
                    ${matchingContactsHtml}
                </div>

                <div class="email mt-4">
                    ${emailContent.replace(/\n/g, '<br>')}
                </div>
            </div>
        `;
        });

        if (html) {
            $(".messages-container").html(html);
            this.initializeForwardButtons();
        } else {
            $(".messages-container").html(`
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i>
                No Interac e-Transfer emails found
            </div>
        `);
        }
    }
    showToast(message, type) {
        if (this.parent?.showToast) {
            this.parent.showToast(message, type);
        } else {
            console.error('Parent showToast not available:', message);
        }
    }
    calcDepositPassword(contact) {
        return moment.tz(contact.startTime, 'America/New_York').format("MMMMDD");
    }

    initializeForwardButtons() {
        $('.forward-etransfer').off('click').on('click', async (e) => {
            const $container = $(e.target).closest('.sms');
            const senderName = $container.data('name');
            const amount = $container.data('amount');
            const emailId = $container.data('id');

            try {
                const staffResponse = await $.get('https://eattaco.ca/api/getStaff');
                const activeStaff = staffResponse.filter(staff => staff.active);
                const matches = this.parent.fuse ? this.parent.fuse.search(senderName) : [];


                const modal = document.getElementById('etransfer_modal') || document.createElement('dialog');
                modal.id = 'etransfer_modal';
                modal.className = 'modal';

                modal.innerHTML = `
                <div class="modal-box">
                    <h3 class="font-bold text-lg">Forward eTransfer</h3>
                    <div class="py-4 space-y-4">
                        <div class="alert alert-info">
                            <div class="text-lg">$${amount} from ${senderName}</div>
                        </div>

                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">Select Matching Contact</span>
                            </label>
                            <select class="select select-bordered" id="matchingContacts">
                                <option value="">Select contact...</option>
                                ${matches.map(match => {
                    const depositPw = this.calcDepositPassword(match.item);
                    return `
                                        <option value="${match.item.id}" 
                                                data-password="${depositPw}">
                                            ${match.item.name} (${moment(match.item.startTime).format('MM/DD/YYYY')})
                                        </option>
                                    `;
                }).join('')}
                            </select>
                        </div>

                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">Forward To Staff</span>
                            </label>
                            <select class="select select-bordered" id="sendStaffSelect">
                                <option value="">Select staff member...</option>
                                ${activeStaff.map(staff => `
                                    <option value="${staff.email}" 
                                            data-phone="${staff.phone}">
                                        ${staff.user}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="modal-action">
                        <button class="btn btn-primary" id="sendEtransfer">Send</button>
                        <button class="btn" onclick="etransfer_modal.close()">Cancel</button>
                    </div>
                </div>
            `;

                document.body.appendChild(modal);
                modal.showModal();

                $('#sendEtransfer').off('click').on('click', async () => {
                    const selectedStaff = $('#sendStaffSelect').val();
                    const selectedStaffPhone = $('#sendStaffSelect option:selected').data('phone');
                    const selectedStaffName = $('#sendStaffSelect option:selected').text();
                    const depositPw = $('#matchingContacts option:selected').data('password');

                    if (!selectedStaff || !depositPw) {
                        this.showToast('Please select both a contact and staff member', 'error');
                        return;
                    }

                    try {
                        // Forward email
                        await $.post('/gmail/forwardEmail', {
                            messageId: emailId,
                            to: selectedStaff
                        });

                        // Send SMS
                        const smsData = {
                            to: selectedStaffPhone,
                            message: `This is Luan from TacoTaco. The PW to the etransfer for ${senderName} is ${depositPw}. Please confirm after you've deposited. If there is a problem, message Luan on Whatsapp.`,
                            fromName: 'Luan',
                            amount: amount,
                            toName: selectedStaffName
                        };

                        await $.post('https://eattaco.ca/api/sendStaffSMSInterac', smsData);

                        this.showToast('eTransfer forwarded and SMS sent successfully', 'success');
                        modal.close();
                    } catch (error) {
                        console.error('Error forwarding eTransfer:', error);
                        this.showToast('Error forwarding eTransfer', 'error');
                    }
                });

            } catch (error) {
                console.error('Error loading staff data:', error);
                this.showToast('Error loading staff data', 'error');
            }
        });
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



    refreshEmails() {
        const messagesContainer = $("#messages .messages-container");
        const loadingHtml = `
            <div class="alert alert-info">
                <i class="bi bi-hourglass-split"></i>
                Filtering emails...
            </div>
        `;
        messagesContainer.html(loadingHtml);

        // Get the cached emails
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

    adjustMessagesContainerHeight() {
        const messagesCard = document.querySelector('#messages .card-body');
        const messagesContainer = document.querySelector('.messages-container');

        if (!messagesCard || !messagesContainer) return;

        const containerTop = messagesContainer.offsetTop;
        const cardContentHeight = messagesCard.clientHeight;
        const newHeight = cardContentHeight - containerTop;
        messagesContainer.style.maxHeight = `${Math.max(newHeight, 100)}px`;
    }

    // Moved from EventManageApp
    processEmails(data, options = {}) {
        if (!Array.isArray(data)) {
            console.error("Invalid data format:", data);
            return;
        }

        let filteredEmails = options.ignoreFilters ? data : this.applyFilters();
        if (!Array.isArray(filteredEmails)) {
            filteredEmails = [];
        }
        filteredEmails.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const exclusionArray = ["calendar-notification", "accepted this invitation", "peerspace", "tagvenue"];
        let html = '';

        filteredEmails.forEach((email) => {
            if (!email || !email.subject) {
                console.warn("Skipping invalid email entry:", email);
                return;
            }

            let emailContent = this.formatEmailContent(email.text || email.html);
            if (!emailContent) {
                console.warn("Email has no content:", email);
                return;
            }

            if (exclusionArray.some((exclusion) =>
                email.subject.toLowerCase().includes(exclusion) ||
                emailContent.toLowerCase().includes(exclusion)
            )) {
                return;
            }

            html += this.generateEmailHtml(email, emailContent);
        });

        if (html) {
            $(".messages-container").html(html);
            this.initializeEmailToggles();
        } else {
            $(".messages-container").html(`
                <div class="alert alert-info">
                    <i class="bi bi-info-circle"></i>
                    No emails found
                </div>
            `);
        }
    }

    generateEmailHtml(email, emailContent) {
        const emailAddressMatch = email.from.match(/<([^>]+)>/);
        const emailAddress = emailAddressMatch ? emailAddressMatch[1] : email.from;

        const isUnread = email.labels && email.labels.includes("UNREAD");
        const isImportant = email.labels && email.labels.includes("IMPORTANT");

        const unreadIcon = this.generateStatusIcon(isUnread, "envelope");
        const importantIcon = isImportant ? this.generateImportantIcon() : '';
        const replyIcon = email.replied ? this.generateReplyIcon() : '';

        const timestamp = moment.tz(email.timestamp, 'America/New_York');
        const timeDisplay = timestamp.format("MM/DD/YYYY HH:mm");
        const timeAgo = timestamp.fromNow();

        return `
            <div class="sms ${email.replied ? 'replied' : ''}" 
                 subject="${_.escape(email.subject)}" 
                 to="${_.escape(emailAddress)}" 
                 data-id="${_.escape(email.id)}">
                ${this.generateEmailHeader(unreadIcon, importantIcon, replyIcon)}
                ${this.generateEmailBody(email, emailContent, timeDisplay, timeAgo)}
                ${this.generateEmailActions()}
            </div>
        `;
    }

    // Helper methods for generating email HTML components
    generateStatusIcon(isUnread, type) {
        const icon = isUnread ? `${type}-open-text` : type;
        const status = isUnread ? "Unread" : "Read";
        const colorClass = isUnread ? "text-warning" : "text-secondary";
        return `<button class="icon-btn tooltip" data-tip="${status}"><i class="bi bi-${icon} ${colorClass}"></i></button>`;
    }

    generateImportantIcon() {
        return `<button class="icon-btn tooltip" data-tip="Important"><i class="bi bi-star-fill text-warning"></i></button>`;
    }

    generateReplyIcon() {
        return `<button class="icon-btn tooltip" data-tip="Replied"><i class="bi bi-reply-fill text-success"></i></button>`;
    }

    generateEmailHeader(unreadIcon, importantIcon, replyIcon) {
        return `
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
        `;
    }

    generateEmailBody(email, emailContent, timeDisplay, timeAgo) {
        return `
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
        `;
    }

    generateEmailActions() {
        return `
            <div class="action-buttons flex flex-wrap gap-2 mt-2">
                <button class="icon-btn summarizeEmailAI tooltip tooltip-top" data-tip="Summarize Email">
                    <i class="bi bi-list-task"></i>
                </button>
                <button class="icon-btn draftEventSpecificEmail tooltip tooltip-top" data-tip="Draft Event Email">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="icon-btn getEventDetails tooltip tooltip-top" data-tip="Get Event Information">
                    <i class="bi bi-calendar-plus"></i>
                </button>
                <button class="icon-btn generateConfirmationEmail tooltip tooltip-top" data-tip="Generate Confirmation">
                    <i class="bi bi-envelope"></i>
                </button>
                <button class="icon-btn sendToAiTextArea tooltip tooltip-top" data-tip="Send to AI">
                    <i class="bi bi-send"></i>
                </button>
                <button class="icon-btn archiveEmail tooltip tooltip-top" data-tip="Archive Email">
                    <i class="bi bi-archive"></i>
                </button>
                <button class="icon-btn updateEventInfo tooltip tooltip-top" data-tip="Update Event Info">
                    <i class="bi bi-arrow-up-circle"></i>
                </button>
            </div>
        `;
    }


    initializeEmailToggles() {
        $(document).off('click', '.toggle-button').on('click', '.toggle-button', (e) => {
            e.preventDefault();
            const $button = $(e.currentTarget);
            const $email = $button.closest('.sms').find('.email');
            const $icon = $button.find('i');

            $email.toggleClass('expanded');
            $icon.toggleClass('bi-chevron-down bi-chevron-up');
        });
    }
    loadFilterState() {
        try {
            const savedState = localStorage.getItem('emailFilters');
            if (savedState) {
                const parsed = JSON.parse(savedState);
                return {
                    replied: parsed.replied || false,
                    archived: parsed.archived || false,
                    categories: new Set(parsed.categories || [])
                };
            }
        } catch (error) {
            console.error('Error loading filter state:', error);
        }

        return {
            replied: false,
            archived: false,
            categories: new Set()
        };
    }

    saveFilterState() {
        try {
            const state = {
                replied: this.filters.replied,
                archived: this.filters.archived,
                categories: Array.from(this.filters.categories)
            };
            localStorage.setItem('emailFilters', JSON.stringify(state));
        } catch (error) {
            console.error('Error saving filter state:', error);
        }
    }

    async initializeEmailFilters() {
        try {
            // Load the email categories
            const settings = await this.userSettings.loadSettings();
            const categories = settings.emailCategories;

            if (!Array.isArray(categories)) {
                throw new Error('Invalid categories data received');
            }

            // Create the filter dropdown
            const $filterButton = $('#toggleRepliedEmails');
            const categoriesHtml = categories.map(category => {
                const name = _.escape(category.name || '');
                const description = _.escape(category.description || '');
                return `
                    <li>
                        <label class="label cursor-pointer justify-start gap-2">
                            <input type="checkbox" 
                                   class="checkbox checkbox-sm" 
                                   data-filter="category" 
                                   data-category="${name}">
                            <span class="label-text" title="${description}">
                                ${name} ${description ? `- ${description}` : ''}
                            </span>
                        </label>
                    </li>
                `;
            }).join('');

            const $dropdown = $(`
                <div class="dropdown dropdown-end">
                    <button class="btn btn-ghost btn-sm btn-square tooltip" data-tip="Filter Emails">
                        <i class="bi bi-filter"></i>
                    </button>
                    <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                        <li class="menu-title pt-0">
                            <span>Email Status</span>
                        </li>
                        <li>
                            <label class="label cursor-pointer justify-start gap-2">
                                <input type="checkbox" 
                                       class="checkbox checkbox-sm" 
                                       data-filter="replied">
                                <span class="label-text">Replied</span>
                            </label>
                        </li>
                        <li>
                            <label class="label cursor-pointer justify-start gap-2">
                                <input type="checkbox" 
                                       class="checkbox checkbox-sm" 
                                       data-filter="archived">
                                <span class="label-text">Archived</span>
                            </label>
                        </li>
                        <li class="menu-title">
                            <span>Categories</span>
                        </li>
                        ${categoriesHtml}
                    </ul>
                </div>
            `);

            $filterButton.replaceWith($dropdown);

            // Initialize checkboxes with saved state
            $dropdown.find('input[type="checkbox"]').each((_, checkbox) => {
                const $checkbox = $(checkbox);
                const filterType = $checkbox.data('filter');
                const category = $checkbox.data('category');

                if (filterType === 'category') {
                    $checkbox.prop('checked', this.filters.categories.has(category));
                } else {
                    $checkbox.prop('checked', this.filters[filterType]);
                }
            });

            this.originalEmails = [];

            // Handle checkbox changes with state persistence
            $dropdown.find('input[type="checkbox"]').on('change', (e) => {
                const $checkbox = $(e.target);
                const filterType = $checkbox.data('filter');
                const isChecked = $checkbox.prop('checked');

                if (filterType === 'category') {
                    const category = $checkbox.data('category');
                    if (isChecked) {
                        this.filters.categories.add(category);
                    } else {
                        this.filters.categories.delete(category);
                    }
                } else {
                    this.filters[filterType] = isChecked;
                }

                this.saveFilterState();
                this.applyFilters();
                this.updateFilterButtonStatus();
            });


            // Apply initial filters if any are active
            if (this.filters.replied || this.filters.archived || this.filters.categories.size > 0) {
                this.updateFilterButtonStatus();
            }

        } catch (error) {
            console.error('Error initializing email filters:', error);
            this.parent.showToast('Failed to initialize email filters', 'error');
        }
    }
    applyFilters() {
        if (!Array.isArray(this.originalEmails)) {
            return [];  // Return empty array instead of undefined
        }

        return this.originalEmails.filter(email => {
            // If no filters are active, show all emails
            if (!this.filters.replied &&
                !this.filters.archived &&
                this.filters.categories.size === 0) {
                return true;
            }

            // Check each active filter
            if (this.filters.replied && email.replied) return true;
            if (this.filters.archived && email.labels?.includes('Label_6')) return true;
            if (this.filters.categories.size > 0 &&
                email.category &&
                this.filters.categories.has(email.category)) return true;

            return false;
        });
    }

    // Add methods to support these handlers:
    async handleConfirmationEmail(text, email) {
        try {
            const data = await this.parent.sendAIRequest("/api/sendAIText", {
                aiText: `Write an email to confirm that the event is tomorrow and some of the key details. Also, ask if they have an updated attendance count and ask about catering choices. Be semi-formal.\n\nEvent details: ${text}\nEmail: ${email}.`
            });

            $("#aiText").html(data.replace(/```/g, "").replace(/html/g, "").replace(/\n/g, "<br>") +
                "<br><br>---------------------<br><br>" +
                text.replace(/\n/g, "<br>"));

            this.parent.showToast("Confirmation email generated", "success");
        } catch (error) {
            console.error("Failed to generate confirmation email:", error);
            this.parent.showToast("Failed to generate confirmation email", "error");
        }
    }

    async sendEmail() {
        try {
            const content = $("#aiText").html();
            const to = $("#sendMailEmail").val();
            const subject = $("#sendMailSubject").val();
            const replyToMessageId = $("#aiText").data('replyToMessageId');
            const source = $("#aiText").data('source');

            if (!content || !to || !subject) {
                this.parent.showToast("Please fill in all required fields", "error");
                return;
            }

            if (!confirm("Are you sure you want to send this email?")) {
                return;
            }

            const emailData = {
                html: content,
                to: to,
                subject: subject,
                replyToMessageId: replyToMessageId,
                source: source
            };

            const response = await $.post("/gmail/sendEmail", emailData);

            if (response.success) {
                this.parent.showToast("Email sent successfully", "success");

                // Clear form
                $("#aiText").html('');
                $("#sendMailEmail").val('');
                $("#sendMailSubject").val('');
                $("#aiText").removeData('replyToMessageId');
                $("#aiText").removeData('source');

                // Refresh emails if needed
                if (replyToMessageId) {
                    await this.readGmail();
                    this.updateReplyStatus(replyToMessageId);
                }
            } else {
                throw new Error(response.error || 'Failed to send email');
            }
        } catch (error) {
            console.error("Failed to send email:", error);
            this.parent.showToast("Failed to send email: " + error.message, "error");
        }
    }

    updateReplyStatus(messageId) {
        const $emailContainer = $(`.sms[data-id="${messageId}"]`);
        $emailContainer.addClass('replied');

        const $replyIcon = $emailContainer.find('.icon-btn[data-tip="Replied"]');
        if (!$replyIcon.length) {
            const iconHtml = `
                <button class="icon-btn tooltip" data-tip="Replied">
                    <i class="bi bi-reply-fill text-success"></i>
                </button>
            `;
            $emailContainer.find('.flex.gap-2').append(iconHtml);
        }
    }
    async sendConfirmEmail(text, email) {
        $("#aiText").append(`---------------------<br><br>${text.replace(/\n/g, "<br>")}`);
        try {
            let data = await this.generateConfirmationEmail(text, email);
            data = data.replace(/```/g, "").replace(/html/g, "").replace(/\n/g, "<br>");
            $("#aiText").prepend(data + "<br><br>");
            this.showToast("Confirmation email generated and displayed", "success");
        } catch (error) {
            this.showToast("Failed to generate confirmation email: " + error, "error");
        }
    }
    async generateConfirmationEmail(text, email) {
        const aiPrompt = `Write an email to confirm that the event is tomorrow and some of the key details. Also, ask if they have an updated attendance count and ask about catering choices. Be semi-formal.\n\nEvent details: ${text}\nEmail: ${email}.`;
        return await this.parent.sendAIRequest("/api/sendAIText", { aiText: aiPrompt });

    }
    registerEvents() {
        $(document).on("click", "#readAllEmails", (e) => {
            e.preventDefault();
            this.readGmail("all");
        });

        $(document).on("click", "#emailAI", (e) => {
            e.preventDefault();
            const val = $("#aiText").text();
            this.handleDraftEventEmail(val, "");
        });

        $(document).on("click", ".generateConfirmationEmail", async (e) => {
            e.preventDefault();
            const parent = $(e.target).closest(".sms");
            const text = parent.find(".email").text();
            const email = parent.attr("to");
            $("#sendMailEmail").val(email);
            $("#sendEmail").attr("subject", "Confirmation of Event");
            await this.handleConfirmationEmail(text, email);
        });

        $(document).on("click", "#sendEmail", async (e) => {
            e.preventDefault();
            await this.sendEmail();
        });

        $(document).on('click', '.draftEventSpecificEmail', async (e) => {
            e.preventDefault();
            const $target = $(e.target);
            const $button = $target.hasClass('draftEventSpecificEmail') ?
                $target : $target.closest('.draftEventSpecificEmail');
            const $emailContainer = $button.closest('.sms');

            const messageId = $emailContainer.data('id');
            const emailAddress = $emailContainer.attr('to');
            const subject = $emailContainer.attr('subject');
            const emailContent = $emailContainer.find('.email').text();

            // Store reply context
            $('#aiText').data('replyToMessageId', messageId);
            $('#aiText').data('source', 'draftEventSpecificEmail');

            // Show loading state
            const originalHtml = $button.html();
            $button.html('<i class="bi bi-hourglass-split animate-spin"></i>');

            try {
                await this.handleDraftEventEmail(emailContent, subject, emailAddress, messageId);
            } finally {
                // Restore button
                $button.html(originalHtml);
            }
        });

        $(document).on('click', '.sendToAiTextArea', async (e) => {
            e.preventDefault();
            const $target = $(e.target);
            const $button = $target.hasClass('sendToAiTextArea') ?
                $target : $target.closest('.sendToAiTextArea');
            const $emailContainer = $button.closest('.sms');

            const messageId = $emailContainer.data('id');
            const emailAddress = $emailContainer.attr('to');
            const subject = $emailContainer.attr('subject');
            const emailContent = $emailContainer.find('.email').text();

            // Store reply context
            $('#aiText').data('replyToMessageId', messageId);
            $('#aiText').data('source', 'sendToAiTextArea');

            await this.sendToAiTextArea(emailContent, subject, emailAddress, messageId);
        });
        // Handle email summarization
        $(document).on('click', '.summarizeEmailAI', async (e) => {
            e.preventDefault();
            const emailContent = $(e.target).closest('.sms').find('.email').text();
            await this.handleSummarizeEmail(emailContent);
        });

        // Handle draft event email

        $(document).on('click', '.archiveEmail', async (e) => {
            e.preventDefault();
            const $emailContainer = $(e.target).closest('.sms');
            const messageId = $emailContainer.data('id');

            const success = await this.archiveEmail(messageId);
            if (success) {
                this.parent.showToast('Email archived successfully', 'success');

            } else {
                this.parent.showToast('Failed to archive email', 'error');
            }
        });

        // Handle new conversation button
        $(document).on('click', '#newConversation', () => {
            this.startNewConversation();
        });
    }

    startNewConversation() {
        this.currentConversationId = null;
        $('#aiText').html('');
        $('#aiResult').html('');
        $('#sendMailSubject').val(''); // Clear subject when starting new conversation

    }
    initializeUserSettings() {
        return {
            loadSettings: async () => {
                try {
                    const response = await fetch('/api/settings/email-categories');
                    return await response.json();
                } catch (error) {
                    console.error('Error loading user settings:', error);
                    return {
                        emailCategories: [{
                            name: "event_platform",
                            description: "Emails mentioning Tagvenue or Peerspace"
                        }, {
                            name: "event",
                            description: "Emails related to event bookings, catering, drinks"
                        }, {
                            name: "other",
                            description: "Any other type of email, including receipts"
                        }]
                    };
                }
            },
            saveSettings: async (settings) => {
                const response = await fetch('/api/settings/email-categories', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                return response.json();
            }
        };
    }
    async handleSummarizeEmail(emailContent) {
        try {
            // Clean and truncate the email content
            const cleanedText = emailContent
                .replace(/[-<>]/g, '')
                .replace(/^Sent:.*$/gm, '')
                .substring(0, 11000);

            const response = await $.post('/api/summarizeAI', {
                text: cleanedText,
                conversationId: this.currentConversationId
            });

            // Store the conversation ID for future interactions
            this.currentConversationId = response.conversationId;

            // Write the summary to the AI result area
            this.parent.writeToAIResult(response.summary);

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
                this.showToast('Email archived successfully', 'success');
                return true;
            }
            this.showToast('Failed to archive email', 'error');
            return false;
        } catch (error) {
            console.error('Error archiving email:', error);
            this.showToast('Error archiving email', 'error');
            return false;
        }
    }
    async handleDraftEventEmail(emailContent, subject, emailAddress, messageId) {
        try {
            const response = await $.post('/api/getAIEmail', {
                emailText: emailContent,
                conversationId: this.currentConversationId,
                includeBackground: true
            });

            // Handle email form setup
            this.setupEmailForm({
                emailAddress,
                subject,
                messageId,
                response,
                source: 'draftEventSpecificEmail'
            });

            // Update UI
            this.parent.writeToAIResult(response.response.toString().replace(/\n/g, '<br>'));

            // Play notification if available
            if (this.parent.sounds?.orderUp) {
                this.parent.sounds.orderUp.play();
            }

        } catch (error) {
            console.error('Error drafting event email:', error);
            this.parent.showToast('Failed to draft event email', 'error');
        }
    }
    async sendToAiTextArea(emailContent, subject, emailAddress, messageId) {
        // Format and append content with reply context
        const formattedContent = this.formatEmailContent(emailContent);

        // Setup email form with reply context
        this.setupEmailForm({
            emailAddress,
            subject,
            messageId,
            source: 'sendToAiTextArea'
        });

        // Update text area content
        $('#aiText').html(this.currentConversationId ?
            $('#aiText').html() + '<br><br>--------------------<br><br>' + formattedContent :
            formattedContent
        );

        // Scroll to editor
        $('html, body').animate({
            scrollTop: $('#aiText').offset().top
        }, 500);

        $('#aiText').focus();
    }
    setupEmailForm({ emailAddress, subject, messageId, response = {}, source }) {
        // Set email recipient
        if (emailAddress) {
            $('#sendMailEmail').val(emailAddress);
        }

        // Set email subject with proper reply prefix
        if (subject) {
            const subjectText = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
            $('#sendMailSubject').val(subjectText);
        }

        // Store reply context
        $('#aiText').data('replyToMessageId', messageId);
        $('#aiText').data('source', source);

        // Set conversation ID if provided
        if (response.conversationId) {
            this.currentConversationId = response.conversationId;
        }

        // Update conversation status if needed
        if (response.messageCount) {
            this.updateConversationStatus(response.messageCount);
        }
    }
    updateFilterButtonStatus() {
        const $filterButton = $('.dropdown > button');
        const activeFilters = [
            this.filters.replied && 'Replied',
            this.filters.archived && 'Archived',
            ...Array.from(this.filters.categories)
        ].filter(Boolean);

        if (activeFilters.length > 0) {
            $filterButton
                .addClass('btn-primary')
                .attr('data-tip', `Active Filters: ${activeFilters.join(', ')}`);
        } else {
            $filterButton
                .removeClass('btn-primary')
                .attr('data-tip', 'Filter Emails');
        }
    }

    formatEmailContent(content) {
        return content
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\n/g, '<br>');
    }
    updateConversationStatus(messageCount) {
        if (messageCount) {
            const statusHtml = `<div class="text-muted small mt-2">Conversation messages: ${messageCount}</div>`;
            $('.aiChatReponse').first().find('.aiChatReponseContent').after(statusHtml);
        }
    }
}