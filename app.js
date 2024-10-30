//--- File: /home/luan_ngo/web/events/app.js ---

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');

// Initialize app
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files
app.use(session({
  secret: 'yourSecretKey',
  resave: false,
  saveUninitialized: true,
}));

// Routes
const oauthRoutes = require('./routes/oauth');
const gmailRoutes = require('./routes/gmail');
const eventsRoutes = require('./routes/events');
const calendarRoutes = require('./routes/calendar');
const aiRoutes = require('./routes/ai');

app.use('/oauth', oauthRoutes);
app.use('/gmail', gmailRoutes);
app.use('/events', eventsRoutes);
app.use('/calendar', calendarRoutes);
app.use('/ai', aiRoutes);

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html')); // Serve the main page
});

// Start the server
const PORT = 3003;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = app;
