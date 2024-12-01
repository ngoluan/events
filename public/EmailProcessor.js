class EmailProcessor {
    constructor(parent) {
        this.currentConversationId = null;
        this.registerEvents();
        this.parent = parent;
        this.filters = this.loadFilterState();

        this.userSettings = {
            async loadSettings() {
                try {
                    const response = await fetch('/api/settings/email-categories');
                    const data = await response.json();
                    return data; // Return the whole object
                } catch (error) {
                    console.error('Error loading user settings:', error);
                    return {
                        emailCategories: [{
                            name: "event_platform",
                            description: "Emails mentioning Tagvenue or Peerspace"
                        }, {
                            name: "event",
                            description: "Emails related to event bookings, catering, drinks. do not include opentable emails."
                        }, {
                            name: "other",
                            description: "Any other type of email, including receipts"
                        }]
                    };
                }
            },
            async saveSettings(settings) {
                try {
                    const response = await fetch('/api/settings/email-categories', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(settings)
                    });
                    return await response.json();
                } catch (error) {
                    console.error('Error saving user settings:', error);
                    throw error;
                }
            }
        };
        this.initializeEmailFilters();
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

            // Override readGmail to store original emails
            const originalReadGmail = this.parent.readGmail;
            this.parent.readGmail = async (...args) => {
                const response = await originalReadGmail.apply(this.parent, args);
                if (Array.isArray(response)) {
                    this.originalEmails = response;
                }
                this.applyFilters();
                return response;
            };

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
        if (!Array.isArray(this.originalEmails)) return;
    
        const filteredEmails = this.originalEmails.filter(email => {
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
    
        // Process and display the filtered emails
        this.processEmails(filteredEmails, { ignoreFilters: true });
    
        // Update the email count display
        const totalEmails = this.originalEmails.length;
        const filteredCount = filteredEmails.length;
        const $messageHeader = $('.messages-container').siblings('.flex');
        const $countDisplay = $messageHeader.find('.email-count');
        
        if ($countDisplay.length === 0) {
            $messageHeader.append(`
                <span class="email-count text-sm opacity-70">
                    Showing ${filteredCount} of ${totalEmails} emails
                </span>
            `);
        } else {
            $countDisplay.text(`Showing ${filteredCount} of ${totalEmails} emails`);
        }
    }
    registerEvents() {
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
                window.app.showToast('Email archived successfully', 'success');
            } else {
                window.app.showToast('Failed to archive email', 'error');
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
                // Remove the email from the UI
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