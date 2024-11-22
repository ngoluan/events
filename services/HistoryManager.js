const fs = require('fs');
const path = require('path');

class HistoryManager {
    constructor() {
        this.historyFilePath = path.join(__dirname, '..', 'data', 'history.json');
        this.maxEntries = 1000; // Keep last 1000 entries
        this.initializeHistory();
    }

    initializeHistory() {
        const dataDir = path.dirname(this.historyFilePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        if (!fs.existsSync(this.historyFilePath)) {
            this.saveHistory([]);
        }
    }

    loadHistory() {
        try {
            const history = JSON.parse(fs.readFileSync(this.historyFilePath, 'utf8'));
            return Array.isArray(history) ? history : [];
        } catch (error) {
            console.error('Error loading history:', error);
            return [];
        }
    }

    saveHistory(history) {
        try {
            fs.writeFileSync(this.historyFilePath, JSON.stringify(history, null, 2));
        } catch (error) {
            console.error('Error saving history:', error);
        }
    }

    addEntry(entry) {
        try {
            const history = this.loadHistory();
            const newEntry = {
                ...entry,
                timestamp: new Date().toISOString(),
                id: Date.now().toString() // Unique ID for each entry
            };

            history.push(newEntry);
            
            // Keep only last maxEntries
            const trimmedHistory = history.slice(-this.maxEntries);
            this.saveHistory(trimmedHistory);

            return newEntry;
        } catch (error) {
            console.error('Error adding history entry:', error);
            return null;
        }
    }

    getEntries(filters = {}) {
        try {
            const history = this.loadHistory();
            let filteredHistory = [...history];

            // Apply filters if they exist
            if (filters.type) {
                filteredHistory = filteredHistory.filter(entry => entry.type === filters.type);
            }
            if (filters.startDate) {
                filteredHistory = filteredHistory.filter(entry => 
                    new Date(entry.timestamp) >= new Date(filters.startDate)
                );
            }
            if (filters.endDate) {
                filteredHistory = filteredHistory.filter(entry => 
                    new Date(entry.timestamp) <= new Date(filters.endDate)
                );
            }

            return filteredHistory;
        } catch (error) {
            console.error('Error getting history entries:', error);
            return [];
        }
    }

    getEntryById(id) {
        try {
            const history = this.loadHistory();
            return history.find(entry => entry.id === id);
        } catch (error) {
            console.error('Error getting history entry:', error);
            return null;
        }
    }

    getRecentEntriesByType(type, limit = 10) {
        try {
            const history = this.loadHistory();
            return history
                .filter(entry => entry.type === type)
                .slice(-limit);
        } catch (error) {
            console.error('Error getting recent history entries:', error);
            return [];
        }
    }

    clearHistory() {
        try {
            this.saveHistory([]);
            return true;
        } catch (error) {
            console.error('Error clearing history:', error);
            return false;
        }
    }
}

module.exports = new HistoryManager();