const fs = require('fs');
const path = require('path');

class User {
    constructor() {
        this.settingsPath = path.join(__dirname, '..', 'data', 'userSettings.json');
        this.settings = null;
    }
    async loadSettings() {
        try {
            const data = await fs.promises.readFile(this.settingsPath, 'utf8');
            this.settings = JSON.parse(data);
            return this.settings;
        } catch (error) {
            if (error.code === 'ENOENT') {
                const defaultSettings = {
                    emailCategories: {
                        'event_platform': 'Emails mentioning Tagvenue or Peerspace',
                        'event': 'Emails related to event bookings, catering, drinks. do not include opentable emails.',
                        'other': 'Any other type of email, including receipts',
                    },
                };
                await this.saveSettings(defaultSettings);
                this.settings = defaultSettings;
                return defaultSettings;
            }
            throw error;
        }
    }

    async saveSettings(settings) {
        await fs.promises.writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
        this.settings = settings;
    }

    getCategorySchema() {
        const categories = Object.keys(this.settings?.emailCategories || { 'other': '' });
        return z.object({
            category: z.enum(categories),
        });
    }
}

module.exports = User;