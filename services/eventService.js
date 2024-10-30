// services/eventService.js
const fs = require('fs');
const path = require('path');

const eventsFilePath = path.join(__dirname, '..', 'data', 'events.json');

class EventService {
  loadEvents() {
    if (fs.existsSync(eventsFilePath)) {
      const data = fs.readFileSync(eventsFilePath, 'utf8');
      return JSON.parse(data);
    } else {
      return [];
    }
  }

  saveEvents(events) {
    fs.writeFileSync(eventsFilePath, JSON.stringify(events, null, 2));
  }
}

module.exports = new EventService();
