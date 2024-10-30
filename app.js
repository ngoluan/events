//--- File: /home/luan_ngo/web/events/app.js ---

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const GoogleAuth = require('./services/GoogleAuth');

// Initialize GoogleAuth
const googleAuth = new GoogleAuth();

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

// Routes with googleAuth passed in
const oauthRoutes = require('./routes/oauth')(googleAuth);
const gmailRoutes = require('./routes/gmail')(googleAuth);
const calendarRoutes = require('./routes/calendar')(googleAuth);
const eventsRoutes = require('./routes/events');
const aiRoutes = require('./routes/ai');

// Use the routers
app.use('/auth', oauthRoutes);
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
