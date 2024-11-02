class EmailProcessor {
    constructor() {
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
            const emailContent = $(e.target).closest('.sms').find('.email').text();
            await this.handleDraftEventEmail(emailContent);
        });

        // Handle get event information
        $(document).on('click', '.getEventDetails', async (e) => {
            e.preventDefault();
            const $emailContainer = $(e.target).closest('.sms');
            const emailContent = $emailContainer.find('.email').text();
            const senderEmail = $emailContainer.attr('to');
            await this.handleGetEventInformation(emailContent, senderEmail);
        });

        // Handle send to textarea
        $(document).on('click', '.sendToAiTextArea', async (e) => {
            e.preventDefault();
            const $emailContainer = $(e.target).closest('.sms');
            const emailContent = $emailContainer.find('.email').text();
            this.sendToAiTextArea(emailContent);
        });
    }

    async handleSummarizeEmail(emailContent) {
        try {
            // Clean and truncate the email content
            const cleanedText = emailContent
                .replace(/[-<>]/g, '')
                .replace(/^Sent:.*$/gm, '')
                .substring(0, 11000);

            const response = await $.post('/api/summarizeAI', { text: cleanedText });

            // Write the summary to the AI result area
            this.writeToAIResult(response.replace(/\n/g, '<br>'));

        } catch (error) {
            console.error('Error summarizing email:', error);
            alert('Failed to summarize email');
        }
    }

    async handleDraftEventEmail(emailContent) {
        try {
            const instructions = prompt('Enter any specific instructions for the email draft:');
            const combinedText = `${emailContent}\n\n[Specific Instructions: ${instructions}]`;

            const response = await $.post('/api/getAIEmail', {
                aiText: combinedText,
                emailText: emailContent,
                includeBackground: true  // Explicitly request background info
            });

            const result = JSON.parse(response);

            // Update the AI text area with the draft
            $('#aiText').html(
                result.response.replace(/\n/g, '<br>') +
                '<br><br> ---------------- <br><br>' +
                $('#aiText').html()
            );

            // If no email is set, use the one from the response
            if ($('#sendMailEmail').val() === '') {
                $('#sendMailEmail').val(result.fromEmail);
            }

        } catch (error) {
            console.error('Error drafting event email:', error);
            alert('Failed to draft event email');
        }
    }

    async handleGetEventInformation(emailContent, senderEmail) {
        try {
            const response = await $.post('/api/sendAIText', {
                aiText: `${emailContent} Email: ${senderEmail}`
            });

            // Extract event details from the response
            const regex = /{[^{}]*}/;
            const match = response.match(regex);

            if (match) {
                const eventDetails = JSON.parse(match[0]);
                // Trigger event to update the events list
                $(document).trigger('eventDetailsReceived', [eventDetails]);
            } else {
                throw new Error('No event details found in response');
            }

        } catch (error) {
            console.error('Error getting event information:', error);
            alert('Failed to get event information');
        }
    }

    sendToAiTextArea(emailContent) {
        // Clear existing content
        $('#aiText').html('');

        // Format and append the email content
        const formattedContent = emailContent.replace(/\n/g, '<br>');
        $('#aiText').html(`<br><br>${formattedContent}`);

        // Scroll to the AI text area
        $('html, body').animate({
            scrollTop: $('#aiText').offset().top
        }, 500);

        // Focus the AI text area
        $('#aiText').focus();
    }

    writeToAIResult(data) {
        // Remove any specific instructions from the response
        data = data.replace(/:\[Specific Instructions:.*?\]/g, '');

        const responseHTML = `
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

        $('#aiResult').html(responseHTML);
    }
}