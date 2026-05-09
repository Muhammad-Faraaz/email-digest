# Email Digest Menu Bar App

A macOS menu bar app built with Electron, React (Vite), and Tailwind CSS that summarizes today's Gmail inbox using Claude.

## Features

- Lives in macOS menu bar with no dock icon
- Native-style tray dropdown panel (380 x 520)
- Gmail OAuth 2.0 with token persistence
- Digest summarization with Claude (`claude-sonnet-4-20250514`)
- Auto refresh on launch and every 30 minutes
- Last successful digest persisted and shown instantly
- Friendly states for loading, errors, and first-time Gmail connection

## Setup

### 1) Clone and install

```bash
git clone <your-repo-url>
cd email-digest
npm install
```

### 2) Configure Google Cloud + Gmail API

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Go to **APIs & Services > Library** and enable **Gmail API**
4. Go to **APIs & Services > OAuth consent screen** and configure consent (External or Internal)
5. Go to **APIs & Services > Credentials**
6. Create **OAuth client ID** with application type **Desktop app**
7. Set redirect URI to:

```text
http://localhost:3000/oauth2callback
```

8. Copy the client ID and client secret

### 3) Get Anthropic API key

1. Open [Anthropic Console](https://console.anthropic.com/)
2. Create or copy your API key

### 4) Create `.env` from `.env.example`

```bash
cp .env.example .env
```

Populate:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (default already set)
- `ANTHROPIC_API_KEY`

### 5) Run in development

```bash
npm run dev
```

### 6) Build distributable DMG

```bash
npm run build
```

The generated `.dmg` will be produced by `electron-builder` in the output directory.

## Notes

- The app is hidden from Dock (`app.dock.hide()`)
- App auto-starts at login (`app.setLoginItemSettings`)
- Tokens and last digest are saved via `electron-store`
- `.env` is gitignored and should never be committed
