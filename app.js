//--- File: /home/luan_ngo/web/events/app.js ---

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const GoogleAuth = require('./services/GoogleAuth');
const EmailProcessorServer = require('./services/EmailProcessorServer');
const GmailService = require('./services/gmailService');
const EventService = require('./services/eventService');
const cron = require('node-cron');
const usersRoutes = require('./routes/users');

// Initialize GoogleAuth
const googleAuth = new GoogleAuth();

// Initialize app
const app = express();

const gmailService = new GmailService(googleAuth);
const eventService = new EventService(googleAuth);


gmailService.setEventService(eventService);
eventService.setGmailService(gmailService);

const emailProcessor = new EmailProcessorServer(googleAuth, gmailService,eventService);

/* cron.schedule('0 * * * *', async () => {
  try {
    console.log('Running getAndMakeSuggestionsFromEmails...');
    await emailProcessor.getAndMakeSuggestionsFromEmails();
  } catch (error) {
    console.error('Error in scheduled task:', error);
  }
}); */

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files
app.use(session({
  secret: 'yourSecretKey',
  resave: false,
  saveUninitialized: true,
}));

const oauthRoutes = require('./routes/oauth')(googleAuth);
const gmailRoutes = require('./routes/gmail')(googleAuth, gmailService);
const calendarRoutes = require('./routes/calendar')(googleAuth);
const eventsRoutes = require('./routes/events')(googleAuth, eventService);
const aiRoutes = require('./routes/ai');

// Use the routers
app.use('/auth', oauthRoutes);
app.use('/gmail', gmailRoutes);
app.use('/', eventsRoutes);
app.use('/calendar', calendarRoutes);
app.use('/ai', aiRoutes);
app.use('/', emailProcessor.getRouter());
app.use('/', usersRoutes);


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
