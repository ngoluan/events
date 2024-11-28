class EmailProcessor {
    constructor(parent) {
        this.currentConversationId = null;
        this.registerEvents();
        this.parent = parent;
        this.userSettings = {
            userSettings: {
                async loadSettings() {
                    try {
                        const response = await fetch('/api/settings/email-categories');
                        return await response.json();
                    } catch (error) {
                        console.error('Error loading user settings:', error);
                        return {
                            emailCategories: [
                                {
                                    "name": "event_platform",
                                    "description": "Emails mentioning Tagvenue or Peerspace"
                                },
                                {
                                    "name": "event",
                                    "description": "Emails related to event bookings, catering, drinks. do not include opentable emails."
                                },
                                {
                                    "name": "other",
                                    "description": "Any other type of email, including receipts"
                                }
                            ]
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
            }
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