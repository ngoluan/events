const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const User = require('../services/User');

class UsersRoute {
    constructor() {
        this.router = express.Router();
        this.user = new User();
        this.setupRoutes();
    }

    setupRoutes() {
        // Get email categories
        this.router.get('/api/settings/email-categories', async (req, res) => {
            try {
                const settings = await this.user.loadSettings();

                if (!settings || !settings.emailCategories) {
                    // Return default categories if none exist
                    return res.json({
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
                        ]
                    });
                }

                res.json({ emailCategories: settings.emailCategories });
            } catch (error) {
                console.error('Error loading email categories:', error);
                res.status(500).json({
                    error: 'Failed to load email categories',
                    details: error.message
                });
            }
        });

        // Update email categories
        this.router.post('/api/settings/email-categories', async (req, res) => {
            try {
                const { emailCategories } = req.body;

                if (!Array.isArray(emailCategories)) {
                    return res.status(400).json({
                        error: 'Invalid format. Expected array of categories.'
                    });
                }

                // Validate each category has required fields
                const validCategories = emailCategories.filter(category =>
                    category &&
                    typeof category.name === 'string' &&
                    typeof category.description === 'string'
                );

                await this.user.saveSettings({
                    emailCategories: validCategories
                });

                res.json({
                    success: true,
                    message: 'Email categories updated successfully',
                    emailCategories: validCategories
                });
            } catch (error) {
                console.error('Error saving email categories:', error);
                res.status(500).json({
                    error: 'Failed to save email categories',
                    details: error.message
                });
            }
        });

        // Get all user settings
        this.router.get('/api/settings', async (req, res) => {
            try {
                const settings = await this.user.loadSettings();
                res.json(settings);
            } catch (error) {
                console.error('Error loading user settings:', error);
                res.status(500).json({
                    error: 'Failed to load user settings',
                    details: error.message
                });
            }
        });

        // Update user settings
        this.router.post('/api/settings', async (req, res) => {
            try {
                const settings = req.body;
                await this.user.saveSettings(settings);
                res.json({
                    success: true,
                    message: 'Settings updated successfully'
                });
            } catch (error) {
                console.error('Error saving user settings:', error);
                res.status(500).json({
                    error: 'Failed to save user settings',
                    details: error.message
                });
            }
        });
    }

    getRouter() {
        return this.router;
    }
}

module.exports = new UsersRoute().getRouter();