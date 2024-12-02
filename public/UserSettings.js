export class UserSettings {
    constructor(app) {
        this.app = app;
        this.emailCategories = [];
        this.backgroundInfo = '';
        this.initializeEventListeners();
    }

    async initializeSettings() {
        try {
            // Load background info
            const backgroundResponse = await fetch('/api/settings/background');
            const backgroundData = await backgroundResponse.json();
            $('#backgroundInfo').val(backgroundData.backgroundInfo || '');
            this.backgroundInfo = backgroundData.backgroundInfo || '';

            // Load email categories
            const categoriesResponse = await fetch('/api/settings/email-categories');
            const data = await categoriesResponse.json();

            if (!data.emailCategories || !Array.isArray(data.emailCategories)) {
                throw new Error('Invalid email categories format');
            }

            this.emailCategories = data.emailCategories;
            this.renderEmailCategories();
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.app.showToast('Failed to load settings', 'error');
        }
    }

    renderEmailCategories() {
        // Generate rows from categories array
        const categoryRows = this.emailCategories.map((category, index) => `
            <tr>
                <td>
                    <input type="text" 
                           id="emailCategoryName-${index}" 
                           class="input input-bordered w-full" 
                           value="${_.escape(category.name)}" />
                </td>
                <td>
                    <input type="text" 
                           id="emailCategoryDescription-${index}" 
                           class="input input-bordered w-full" 
                           value="${_.escape(category.description)}" />
                </td>
                <td>
                    <button class="btn btn-square btn-sm btn-error delete-category" data-index="${index}">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        $('#emailCategoryTable tbody').html(categoryRows);
    }

    initializeEventListeners() {
        // Delete category handler
        $(document).on('click', '.delete-category', (e) => {
            $(e.currentTarget).closest('tr').remove();
        });

        // Add category handler
        $('#addEmailCategory').on('click', () => {
            const newRow = `
                <tr>
                    <td>
                        <input type="text" 
                               id="emailCategoryName-${$('#emailCategoryTable tbody tr').length}" 
                               class="input input-bordered w-full" 
                               placeholder="Category Name" />
                    </td>
                    <td>
                        <input type="text" 
                               id="emailCategoryDescription-${$('#emailCategoryTable tbody tr').length}" 
                               class="input input-bordered w-full" 
                               placeholder="Category Description" />
                    </td>
                    <td>
                        <button class="btn btn-square btn-sm btn-error delete-category">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
            $('#emailCategoryTable tbody').append(newRow);
        });

        // Save settings handler
        $('#saveBackgroundInfo').on('click', async () => {
            await this.saveSettings();
        });

        // Google OAuth handlers
        $('#googleOAuthButton').on('click', () => {
            this.initiateGoogleOAuth();
        });

        $('#logoutButton').on('click', () => {
            this.logout();
        });
    }

    async saveSettings() {
        try {
            // Save background info
            const backgroundInfo = $('#backgroundInfo').val();
            await fetch('/api/settings/background', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ backgroundInfo })
            });
            this.backgroundInfo = backgroundInfo;

            // Save email categories
            const emailCategories = [];
            $('#emailCategoryTable tbody tr').each((index, row) => {
                const name = $(`#emailCategoryName-${index}`, row).val().trim();
                const description = $(`#emailCategoryDescription-${index}`, row).val().trim();
                if (name !== '') {
                    emailCategories.push({ name, description });
                }
            });
            this.emailCategories = emailCategories;

            await this.saveEmailCategories({ emailCategories });
            this.app.showToast('Settings saved successfully', 'success');
            this.showSaveStatus('success');
        } catch (error) {
            console.error('Error saving settings:', error);
            this.app.showToast('Failed to save settings', 'error');
            this.showSaveStatus('error');
        }
    }

    async saveEmailCategories(settings) {
        await fetch('/api/settings/email-categories', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(settings)
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

        setTimeout(() => {
            $saveStatus.addClass('hidden');
        }, 3000);
    }

    async initiateGoogleOAuth() {
        try {
            const response = await $.get('/auth/google');
            if (response.authUrl) {
                window.location.href = response.authUrl;
            } else {
                this.app.showToast('Failed to initiate Google OAuth.', 'error');
            }
        } catch (error) {
            console.error('Error initiating Google OAuth:', error);
            this.app.showToast('Error connecting to Google', 'error');
        }
    }

    async logout() {
        try {
            const response = await $.post('/api/logout');
            if (response.success) {
                this.app.showToast('Logged out successfully', 'success');
                location.reload();
            } else {
                this.app.showToast('Failed to log out', 'error');
            }
        } catch (error) {
            console.error('Error logging out:', error);
            this.app.showToast('Error during logout', 'error');
        }
    }

    setConnectedEmail(email) {
        $('#connectedEmail').text(`Connected as: ${email}`);
    }

    getBackgroundInfo() {
        return this.backgroundInfo;
    }

    getEmailCategories() {
        return this.emailCategories;
    }
}