class GoogleAuth {
    constructor() {
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = 'https://your-domain.com/oauth/google/callback';
        this.tokenPath = path.join(__dirname, '../data/tokens.json');
        this.tokens = this.loadTokens();
        
        // Token refresh threshold (5 minutes before expiry)
        this.tokenRefreshThreshold = 5 * 60 * 1000;
    }

    async getOAuth2ClientForEmail(userEmail, gmailEmail) {
        const oAuth2Client = new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );

        try {
            const userTokens = this.tokens.find(user => user.userEmail === userEmail);
            if (!userTokens) {
                throw new Error(`No tokens found for user email: ${userEmail}`);
            }

            const account = userTokens.accounts.find(acc => acc.email === gmailEmail && acc.accountType === 'gmail');
            if (!account) {
                throw new Error(`No tokens found for Gmail email: ${gmailEmail}`);
            }

            // Check if token needs refresh
            if (this.shouldRefreshToken(account.tokens)) {
                const newTokens = await this.refreshTokens(oAuth2Client, account.tokens);
                account.tokens = newTokens;
                await this.saveTokens();
            }

            oAuth2Client.setCredentials(account.tokens);

            // Set up token refresh listener
            oAuth2Client.on('tokens', async (newTokens) => {
                if (newTokens.refresh_token) {
                    account.tokens.refresh_token = newTokens.refresh_token;
                }
                account.tokens.access_token = newTokens.access_token;
                account.tokens.expiry_date = newTokens.expiry_date;
                
                await this.saveTokens();
                console.log(`Tokens refreshed and saved for ${gmailEmail}`);
            });

            return oAuth2Client;
        } catch (error) {
            console.error('Error getting OAuth2Client:', error);
            throw error;
        }
    }

    shouldRefreshToken(tokens) {
        if (!tokens.expiry_date) return true;
        return tokens.expiry_date - Date.now() <= this.tokenRefreshThreshold;
    }

    async refreshTokens(oAuth2Client, tokens) {
        oAuth2Client.setCredentials({
            refresh_token: tokens.refresh_token
        });

        try {
            const { credentials } = await oAuth2Client.refreshAccessToken();
            return credentials;
        } catch (error) {
            console.error('Error refreshing access token:', error);
            throw error;
        }
    }

    generateAuthUrl(selectedEmail, userEmail, accountType) {
        const state = this.generateState(selectedEmail, userEmail, accountType);
        
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
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/calendar.events'
            ],
            state: state
        });
    }

    async handleCallback(code, state) {
        try {
            const decodedState = jwt.verify(state, process.env.JWT_SECRET);
            const { selectedEmail, userEmail, accountType } = decodedState;

            if (!selectedEmail || !userEmail) {
                throw new Error('Invalid state parameter');
            }

            const oAuth2Client = new google.auth.OAuth2(
                this.clientId,
                this.clientSecret,
                this.redirectUri
            );

            const { tokens } = await oAuth2Client.getToken(code);
            
            // Verify token by making a test API call
            oAuth2Client.setCredentials(tokens);
            const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
            const profile = await gmail.users.getProfile({ userId: 'me' });
            const gmailEmail = profile.data.emailAddress;

            await this.saveTokenForEmail(userEmail, gmailEmail, tokens, accountType);

            return { 
                success: true, 
                email: gmailEmail 
            };
        } catch (error) {
            console.error('Error handling callback:', error);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    async saveTokens() {
        try {
            await fs.promises.writeFile(
                this.tokenPath, 
                JSON.stringify(this.tokens, null, 2), 
                'utf8'
            );
        } catch (error) {
            console.error('Error saving tokens:', error);
            throw error;
        }
    }

    loadTokens() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                const tokensData = fs.readFileSync(this.tokenPath, 'utf8');
                return JSON.parse(tokensData);
            }
        } catch (error) {
            console.error('Error loading tokens:', error);
        }
        return [];
    }

    async revokeAccess(userEmail, gmailEmail) {
        const userTokens = this.tokens.find(user => user.userEmail === userEmail);
        if (userTokens) {
            const accountIndex = userTokens.accounts.findIndex(acc => acc.email === gmailEmail);
            if (accountIndex !== -1) {
                userTokens.accounts.splice(accountIndex, 1);
                await this.saveTokens();
                return true;
            }
        }
        return false;
    }
}

module.exports = GoogleAuth;