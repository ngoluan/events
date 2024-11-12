class EmailEventUpdater {
    constructor(app) {
        this.app = app;
        this.highlightedFields = new Set();
    }

    async updateEventFromEmail(emailContent, emailAddress) {
        try {
            // Find the corresponding event
            const event = this.app.contacts.find(contact => 
                contact.email && contact.email.toLowerCase() === emailAddress.toLowerCase()
            );

            if (!event) {
                this.app.showToast('No matching event found for this email', 'error');
                return;
            }

            // Load the contact details
            this.app.loadContact(event.id);

            // Get AI analysis of the update
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

            // Update the event notes
            const timestamp = moment().format('MM/DD/YYYY HH:mm');
            const updatedNotes = `[${timestamp}] Update from email:\n${result.summary}\n\n${event.notes || ''}`;
            
            // Update the event object
            event.notes = updatedNotes;
            
            // Update the UI
            const updatedFields = new Set(['notes']);
            this.updateUI(event, updatedFields);

            // Automatically save the updated event
            //await this.app.saveContactInfo();

            // Show success message
            //this.app.showToast('Event information updated', 'success');

            return true;
        } catch (error) {
            console.error('Error updating event from email:', error);
            this.app.showToast('Failed to update event information', 'error');
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