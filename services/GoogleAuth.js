const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const dotenv = require('dotenv');
dotenv.config();

class GoogleAuth {
    constructor() {
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://events.luanngo.ca/auth/google/callback';
        this.tokenPath = path.join(__dirname, '../data/token.json');
        this.token = this.loadToken();
    }

    generateAuthUrl() {
        const oAuth2Client = new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );

        return oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/gmail.readonly',
                'https://www.googleapis.com/auth/gmail.send',
                'https://www.googleapis.com/auth/gmail.labels',
                'https://www.googleapis.com/auth/gmail.modify',  // Add this scope
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/calendar.events'
            ]
        });
    }

    async getOAuth2Client() {
        if (!this.clientId || !this.clientSecret) {
            throw new Error('Missing Google OAuth credentials. Check your environment variables.');
        }

        const oAuth2Client = new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );

        if (!this.token) {
            throw new Error('No authentication token found. Please authenticate first.');
        }

        if (this.shouldRefreshToken(this.token)) {
            try {
                const newToken = await this.refreshToken(oAuth2Client, this.token);
                this.token = newToken;
                await this.saveToken(newToken);
            } catch (error) {
                console.error('Error refreshing token:', error);
                throw error;
            }
        }

        oAuth2Client.setCredentials(this.token);
        return oAuth2Client;
    }

    async handleCallback(code) {
        try {
            const oAuth2Client = new google.auth.OAuth2(
                this.clientId,
                this.clientSecret,
                this.redirectUri
            );

            const { tokens } = await oAuth2Client.getToken(code);
            
            // Get user email
            oAuth2Client.setCredentials(tokens);
            const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
            const profile = await gmail.users.getProfile({ userId: 'me' });
            
            // Save tokens
            tokens.email = profile.data.emailAddress;
            await this.saveToken(tokens);
            this.token = tokens;

            return { 
                success: true, 
                email: profile.data.emailAddress 
            };
        } catch (error) {
            console.error('Error in handleCallback:', error);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    shouldRefreshToken(token) {
        if (!token.expiry_date) return true;
        return token.expiry_date - Date.now() <= 5 * 60 * 1000; // 5 minutes before expiry
    }

    async refreshToken(oAuth2Client, token) {
        try {
            oAuth2Client.setCredentials({
                refresh_token: token.refresh_token
            });

            const { credentials } = await oAuth2Client.refreshAccessToken();
            return { ...credentials, email: token.email };
        } catch (error) {
            console.error('Error refreshing token:', error);
            throw error;
        }
    }

    loadToken() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                return JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading token:', error);
        }
        return null;
    }

    async saveToken(token) {
        try {
            const tokenDir = path.dirname(this.tokenPath);
            if (!fs.existsSync(tokenDir)) {
                fs.mkdirSync(tokenDir, { recursive: true });
            }
            await fs.promises.writeFile(
                this.tokenPath, 
                JSON.stringify(token, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('Error saving token:', error);
            throw error;
        }
    }

    async revokeAccess() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                await fs.promises.unlink(this.tokenPath);
                this.token = null;
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error revoking access:', error);
            throw error;
        }
    }
}

// Export the class instead of an instance
module.exports = GoogleAuth;