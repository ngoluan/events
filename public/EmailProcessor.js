class EmailProcessor {
    constructor() {
        this.currentConversationId = null;
        this.registerEvents();
    }

    registerEvents() {
        // Handle email summarization
        $(document).on('click', '.summarizeEmailAI', async (e) => {
            e.preventDefault();
            const emailContent = $(e.target).closest('.sms').find('.email').text();
            await this.handleSummarizeEmail(emailContent);
        });

        // Handle draft event email
        $(document).on('click', '.draftEventSpecificEmail', async (e) => {
            e.preventDefault();
            const $emailContainer = $(e.target).closest('.sms');

            const emailContent = $(e.target).closest('.sms').find('.email').text();
            const subject = $emailContainer.attr('subject') || '';
            await this.handleDraftEventEmail(emailContent, subject);
        });

        // Handle send to textarea
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
            this.writeToAIResult({
                content: response.summary,
                messageCount: response.messageCount,
                isNewConversation: !this.currentConversationId
            });

        } catch (error) {
            console.error('Error summarizing email:', error);
            alert('Failed to summarize email');
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

            // Store the conversation ID
            this.currentConversationId = response.conversationId;

            // Update the AI text area with the draft
            const existingContent = $('#aiText').html();
            const newContent = response.response.replace(/\n/g, '<br>');

            $('#aiText').html(
                newContent +
                (existingContent ? '<br><br> ---------------- <br><br>' + existingContent : '')
            );
            // Set the subject if it exists
            if (subject) {
                if (subject.toLowerCase().startsWith('re:')) {
                    $('#sendMailSubject').val(subject);
                } else {
                    $('#sendMailSubject').val(`Re: ${subject}`);
                }
            }
            // If no email is set, use the one from the response
            if ($('#sendMailEmail').val() === '' && response.fromEmail) {
                $('#sendMailEmail').val(response.fromEmail);
            }

            // Show conversation status
            this.updateConversationStatus(response.messageCount);

        } catch (error) {
            console.error('Error drafting event email:', error);
            alert('Failed to draft event email');
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
    async handleGetEventInformation(emailContent, senderEmail) {
        try {
            const response = await $.post('/api/sendAIEventInformation', {
                aiText: `${emailContent} Email: ${senderEmail}`,
                conversationId: this.currentConversationId
            });

            // Store conversation ID
            this.currentConversationId = response.conversationId;

            // Event details are now directly available in the response
            if (response && Object.keys(response).length > 0) {
                // Trigger event to update the events list
                $(document).trigger('eventDetailsReceived', [response]);

                // Show the extracted information in the AI result area
                this.writeToAIResult({
                    content: `Event Details Extracted:<br>${JSON.stringify(response, null, 2)}`,
                    messageCount: response.messageCount,
                    isNewConversation: false
                });
            } else {
                throw new Error('No event details found in response');
            }

        } catch (error) {
            console.error('Error getting event information:', error);
            alert('Failed to get event information');
        }
    }

    sendToAiTextArea(emailContent, subject) {
        // Clear existing content if it's a new conversation
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
        // Format and append the email content
        const formattedContent = emailContent.replace(/\n/g, '<br>');
        $('#aiText').html(
            (this.currentConversationId ? $('#aiText').html() + '<br><br>--------------------<br><br>' : '') +
            formattedContent
        );

        // Scroll to the AI text area
        $('html, body').animate({
            scrollTop: $('#aiText').offset().top
        }, 500);

        // Focus the AI text area
        $('#aiText').focus();
    }

    writeToAIResult({ content, messageCount, isNewConversation }) {
        // Remove any specific instructions from the response
        content = content.replace(/:\[Specific Instructions:.*?\]/g, '');

        const conversationStatus = messageCount ?
            `<div class="text-muted small">Conversation messages: ${messageCount}</div>` : '';

        const responseHTML = `
            <div class="p-2 aiChatReponse">
                <div class="aiChatReponseContent">
                    ${content}
                </div>
                ${conversationStatus}
                <div class="mt-2">
                    <a href="#" class="btn btn-primary sendToAiFromResult" title="Send to AI from Result">
                        <i class="bi bi-send"></i> Send to AI
                    </a>
                    <button class="btn btn-secondary copyToClipboard ml-2" title="Copy to Clipboard">
                        <i class="bi bi-clipboard"></i> Copy
                    </button>
                    ${this.currentConversationId ? `
                        <button class="btn btn-outline-secondary newConversation ml-2" title="Start New Conversation">
                            <i class="bi bi-plus-circle"></i> New Conversation
                        </button>
                    ` : ''}
                </div>
            </div>
        `;

        if (isNewConversation) {
            $('#aiResult').html(responseHTML);
        } else {
            $('#aiResult').prepend(responseHTML);
        }
    }

    updateConversationStatus(messageCount) {
        if (messageCount) {
            const statusHtml = `<div class="text-muted small mt-2">Conversation messages: ${messageCount}</div>`;
            $('.aiChatReponse').first().find('.aiChatReponseContent').after(statusHtml);
        }
    }
}