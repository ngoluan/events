//--- File: /home/luan_ngo/web/events/services/backgroundService.js ---

const fs = require('fs');
const path = require('path');

class BackgroundService {
    constructor() {
        this.backgroundFilePath = path.join(__dirname, '..', 'data', 'background.json');
        this.initializeBackgroundFile();
    }

    initializeBackgroundFile() {
        const dataDir = path.join(__dirname, '..', 'data');
        
        // Create data directory if it doesn't exist
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Create background.json if it doesn't exist
        if (!fs.existsSync(this.backgroundFilePath)) {
            this.saveBackground('');
        }
    }

    getBackground() {
        try {
            const data = fs.readFileSync(this.backgroundFilePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error reading background info:', error);
            return { backgroundInfo: '' };
        }
    }

    saveBackground(backgroundInfo) {
        try {
            fs.writeFileSync(
                this.backgroundFilePath, 
                JSON.stringify({ backgroundInfo }, null, 2),
                'utf8'
            );
            return true;
        } catch (error) {
            console.error('Error saving background info:', error);
            return false;
        }
    }
}

module.exports = new BackgroundService();