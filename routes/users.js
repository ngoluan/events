const express = require('express');
const User = require('../services/User');

class UsersRoute {
    constructor() {
        this.router = express.Router();
        this.user = new User();
        this.setupRoutes();
    }

    setupRoutes() {
        // Get background info
        this.router.get('/api/settings/background', async (req, res) => {
            try {
                const data = await this.user.getBackground();
                res.json(data);
            } catch (error) {
                console.error('Error retrieving background info:', error);
                res.status(500).json({
                    error: 'Failed to retrieve background information',
                    details: error.message
                });
            }
        });

        // Save background info
        this.router.post('/api/settings/background', async (req, res) => {
            try {
                if (!req.body || typeof req.body.backgroundInfo !== 'string') {
                    return res.status(400).json({
                        error: 'Invalid request body. Expected { backgroundInfo: string }',
                        receivedBody: req.body
                    });
                }

                const success = await this.user.saveBackground(req.body.backgroundInfo);

                if (success) {
                    res.json({ success: true });
                } else {
                    res.status(500).json({ error: 'Failed to save background information' });
                }
            } catch (error) {
                console.error('Error saving background info:', error);
                res.status(500).json({
                    error: 'Failed to save background information',
                    details: error.message
                });
            }
        });

        // Get email categories
        this.router.get('/api/settings/email-categories', async (req, res) => {
            try {
                const settings = await this.user.loadSettings();

                if (!settings || !settings.emailCategories) {
                    return res.json({ emailCategories: this.user.getDefaultSettings().emailCategories });
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

                const validCategories = emailCategories.filter(category =>
                    category &&
                    typeof category.name === 'string' &&
                    typeof category.description === 'string'
                );

                const settings = await this.user.loadSettings();
                settings.emailCategories = validCategories;
                await this.user.saveSettings(settings);

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