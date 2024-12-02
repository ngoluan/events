const fs = require('fs');
const path = require('path');
const { z } = require('zod');

class User {
    constructor() {
        this.settingsPath = path.join(__dirname, '..', 'data', 'userSettings.json');
        this.settings = null;
        this.initializeSettings();
    }

    async initializeSettings() {
        const dataDir = path.join(__dirname, '..', 'data');
        
        // Create data directory if it doesn't exist
        if (!fs.existsSync(dataDir)) {
            await fs.promises.mkdir(dataDir, { recursive: true });
        }

        // Create settings file if it doesn't exist
        if (!fs.existsSync(this.settingsPath)) {
            await this.saveSettings(this.getDefaultSettings());
        }
    }

    getDefaultSettings() {
        return {
            emailCategories: [
                {
                    name: "event_platform",
                    description: "Emails mentioning Tagvenue or Peerspace"
                },
                {
                    name: "event",
                    description: "Emails related to event bookings, catering, drinks. do not include opentable emails."
                },
                {
                    name: "other",
                    description: "Any other type of email, including receipts"
                }
            ],
            backgroundInfo: ''
        };
    }

    async loadSettings() {
        try {
            const data = await fs.promises.readFile(this.settingsPath, 'utf8');
            this.settings = JSON.parse(data);
            return this.settings;
        } catch (error) {
            if (error.code === 'ENOENT') {
                const defaultSettings = this.getDefaultSettings();
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

    async getBackground() {
        const settings = await this.loadSettings();
        return { backgroundInfo: settings.backgroundInfo || '' };
    }

    async saveBackground(backgroundInfo) {
        const settings = await this.loadSettings();
        settings.backgroundInfo = backgroundInfo;
        await this.saveSettings(settings);
        return true;
    }

    getCategorySchema() {
        const categories = this.settings?.emailCategories?.map(cat => cat.name) || ['other'];
        return z.object({
            category: z.enum(categories),
        });
    }
}

module.exports = User;