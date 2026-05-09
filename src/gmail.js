import http from 'node:http';
import Store from 'electron-store';
import { google } from 'googleapis';

const authStore = new Store({ name: 'auth' });

function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing Google OAuth environment variables.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function persistTokens(oauth2Client) {
  oauth2Client.on('tokens', (tokens) => {
    if (!tokens) {
      return;
    }

    const currentTokens = authStore.get('gmailTokens', {});
    authStore.set('gmailTokens', {
      ...currentTokens,
      ...tokens
    });
  });
}

async function runOAuthFlow(oauth2Client, openUrl) {
  const scopes = ['https://www.googleapis.com/auth/gmail.readonly'];
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes
  });

  console.log('[Gmail] Starting interactive OAuth flow');

  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url?.startsWith('/oauth2callback')) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const callbackUrl = new URL(req.url, 'http://localhost:3000');
        const code = callbackUrl.searchParams.get('code');
        console.log('[Gmail] OAuth callback received');

        if (!code) {
          throw new Error('No OAuth code returned by Google.');
        }

        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        authStore.set('gmailTokens', tokens);
        console.log('[Gmail] Tokens received and saved');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h3>Gmail connected. You can close this tab and return to the app.</h3>');

        server.close(() => resolve());
      } catch (error) {
        console.error('[Gmail] OAuth callback handling failed:', error);
        server.close(() => reject(error));
      }
    });

    server.listen(3000, () => {
      console.log('[Gmail] OAuth callback server listening on http://localhost:3000');
      if (!openUrl) {
        reject(new Error('No browser opener provided for OAuth flow.'));
        server.close();
        return;
      }
      openUrl(authUrl);
    });

    server.on('error', (error) => {
      console.error('[Gmail] OAuth local server failed:', error);
      reject(error);
    });
  });
}

export async function ensureGmailAuth({ interactive = false, forceAuth = false, openUrl } = {}) {
  const oauth2Client = createOAuthClient();
  persistTokens(oauth2Client);

  const storedTokens = authStore.get('gmailTokens');
  if (storedTokens && !forceAuth) {
    console.log('[Gmail] Using stored OAuth tokens');
    oauth2Client.setCredentials(storedTokens);
    return { oauth2Client, authenticated: true };
  }

  if (!interactive && !forceAuth) {
    console.log('[Gmail] No tokens found and non-interactive mode requested');
    return { oauth2Client: null, authenticated: false };
  }

  await runOAuthFlow(oauth2Client, openUrl);
  console.log('[Gmail] Interactive OAuth completed');
  return { oauth2Client, authenticated: true };
}

function decodeBase64Url(data) {
  if (!data) {
    return '';
  }

  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractBody(payload) {
  if (!payload) {
    return '';
  }

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts?.length) {
    for (const part of payload.parts) {
      const text = extractBody(part);
      if (text) {
        return text;
      }
    }
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return '';
}

function getHeader(headers, name) {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

export async function fetchTodaysEmails(oauth2Client) {
  if (!oauth2Client) {
    throw new Error('Gmail is not authenticated.');
  }

  console.log('[Gmail] Fetching today emails from Gmail API');
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const after = Math.floor(startOfDay.getTime() / 1000);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 20,
    q: `after:${after}`
  });

  const messages = listRes.data.messages || [];
  console.log(`[Gmail] Gmail API returned ${messages.length} messages`);
  if (!messages.length) {
    return [];
  }

  const results = await Promise.all(
    messages.map(async (message) => {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full'
      });

      const payload = full.data.payload;
      const headers = payload?.headers || [];
      const body = extractBody(payload).replace(/\s+/g, ' ').trim();

      return {
        from: getHeader(headers, 'From') || 'Unknown sender',
        subject: getHeader(headers, 'Subject') || '(No subject)',
        snippet: (full.data.snippet || '').trim(),
        body: body.slice(0, 500)
      };
    })
  );

  return results;
}
