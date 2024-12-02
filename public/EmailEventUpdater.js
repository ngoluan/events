class EmailEventUpdater {
    constructor(app) {
        this.app = app;
        this.highlightedFields = new Set();
    }

    async updateEventFromEmail(emailContent, emailAddress) {
        try {
            // Find the corresponding event
            const event = this.app.contacts.getContacts().find(contact => 
                contact.email && contact.email.toLowerCase() === emailAddress.toLowerCase()
            );

            if (!event) {
                this.app.showToast('No matching event found for this email', 'error');
                return false;
            }

            // First, get AI analysis of the update
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

            // Update the event notes with timestamp and summary
            const timestamp = moment().format('MM/DD/YYYY HH:mm');
            const updatedNotes = `[${timestamp}] Update from email:\n${result.summary}\n\n${event.notes || ''}`;
            
            // Update the event object
            event.notes = updatedNotes;

            // Save the updated notes to the server
            await fetch(`/api/events/${event.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(event)
            });

            // Update the UI to show the new notes
            const updatedFields = new Set(['notes']);
            this.updateUI(event, updatedFields);

            // Get the message ID from the email container
            const messageId = $(`.sms[to="${emailAddress}"]`).data('id');
            
            // Archive the email
            if (messageId) {
                const archiveResponse = await fetch(`/gmail/archiveEmail/${messageId}`, {
                    method: 'POST'
                });

                if (archiveResponse.ok) {
                    // Remove the email from the UI
                    $(`.sms[data-id="${messageId}"]`).fadeOut(300, function() {
                        $(this).remove();
                    });
                }
            }

            // Show success message
            this.app.showToast('Event updated and email archived', 'success');
            
            return true;

        } catch (error) {
            console.error('Error updating event from email:', error);
            this.app.showToast('Failed to update event: ' + error.message, 'error');
            return false;
        }
    }

    updateUI(event, updatedFields) {
        // Clear previous highlights
        this.clearHighlights();
        this.highlightedFields = updatedFields;

        // Update form fields and apply highlights
        updatedFields.forEach(field => {
            const element = document.getElementById(`info${field.charAt(0).toUpperCase() + field.slice(1)}`);
            if (element) {
                // Update value
                if (field === 'notes') {
                    element.value = event.notes;
                } else {
                    element.value = event[field];
                }

                // Add highlight
                const label = element.previousElementSibling;
                if (label && label.classList.contains('label')) {
                    label.style.backgroundColor = '#fff3cd';
                }
            }
        });

        // Add event listener for save button to clear highlights
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