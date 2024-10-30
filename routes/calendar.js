// app.js or routes/calendar.js

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Define the route
router.get('/getEventCalendar', (req, res) => {
  const calendarFilePath = path.join(__dirname, 'path_to_your_calendar_file.ics');

  fs.readFile(calendarFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading calendar file:', err);
      return res.status(500).send('Error reading calendar file');
    }
    res.send(data);
  });
});

module.exports = router;
