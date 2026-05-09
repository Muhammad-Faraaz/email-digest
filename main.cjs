const path = require('node:path');
const { app, BrowserWindow, Tray, ipcMain, nativeImage, screen, shell } = require('electron');
const cron = require('node-cron');
const Store = require('electron-store');
const dotenv = require('dotenv');
const { ensureGmailAuth, fetchTodaysEmails } = require('./src/gmail.cjs');
const { summariseEmails } = require('./src/summarise.cjs');

dotenv.config();

const store = new Store();
let tray;
let popupWindow;
let isFetching = false;

function createFallbackTrayImage() {
  const svg = `
  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="4" width="14" height="10" rx="2" ry="2" fill="none" stroke="black" stroke-width="1.5"/>
    <path d="M3 5l6 5 6-5" fill="none" stroke="black" stroke-width="1.5"/>
  </svg>`;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  image.setTemplateImage(true);
  return image;
}

function sendDigestUpdate(payload) {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('digest-update', payload);
  }
}

function getWindowPosition() {
  const trayBounds = tray.getBounds();
  const windowBounds = popupWindow.getBounds();
  const displayBounds = screen.getPrimaryDisplay().workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  x = Math.max(displayBounds.x + 8, Math.min(x, displayBounds.x + displayBounds.width - windowBounds.width - 8));

  const y = Math.round(trayBounds.y + trayBounds.height + 6);
  return { x, y };
}

function toggleWindow() {
  if (popupWindow.isVisible()) {
    popupWindow.hide();
    return;
  }

  const position = getWindowPosition();
  popupWindow.setPosition(position.x, position.y, false);
  popupWindow.show();
  popupWindow.focus();
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs');
  console.log('[Main] preload path:', preloadPath);

  popupWindow = new BrowserWindow({
    width: 380,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    // vibrancy: 'sidebar',
    // visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  popupWindow.on('blur', () => {
    setTimeout(() => {
      if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
        popupWindow.hide();
      }
    }, 500);
  });

  const rendererUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (!app.isPackaged) {
    popupWindow.loadURL(rendererUrl);
  } else {
    popupWindow.loadFile(path.join(__dirname, 'dist/renderer/index.html'));
  }
}

async function fetchAndSummarise({ interactive = false, forceAuth = false } = {}) {
  if (isFetching) {
    console.log('[Main] fetchAndSummarise skipped: already fetching');
    return;
  }

  console.log('[Main] fetchAndSummarise start', { interactive, forceAuth });
  isFetching = true;
  sendDigestUpdate({ state: 'loading', status: 'loading' });

  try {
    const authResult = await ensureGmailAuth({
      interactive,
      forceAuth,
      openUrl: async (url) => {
        console.log('[Main] Opening Google OAuth URL in system browser');
        await shell.openExternal(url);
      }
    });

    if (!authResult.authenticated) {
      console.log('[Main] User unauthenticated, sending unauthenticated state');
      sendDigestUpdate({ state: 'unauthenticated', status: 'unauthenticated' });
      return;
    }

    console.log('[Main] Authenticated, fetching Gmail emails');
    const emails = await fetchTodaysEmails(authResult.oauth2Client);
    console.log(`[Main] Emails fetched: ${emails.length}. Generating summary...`);
    const digest = await summariseEmails(emails);

    const payload = {
      state: 'ready',
      status: 'success',
      digest,
      updatedAt: new Date().toISOString()
    };

    store.set('lastDigest', payload);
    console.log('[Main] Digest ready, stored, and sent to renderer');
    sendDigestUpdate(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch digest.';
    console.error('[Main] fetchAndSummarise failed:', message);

    if (message.toLowerCase().includes('oauth') || message.toLowerCase().includes('auth')) {
      sendDigestUpdate({ state: 'unauthenticated', status: 'unauthenticated', error: message });
    } else {
      sendDigestUpdate({ state: 'error', status: 'error', error: message });
    }
  } finally {
    console.log('[Main] fetchAndSummarise end');
    isFetching = false;
  }
}

function setupIpc() {
  console.log('[Main] Registering IPC handlers');

  ipcMain.handle('fetch-digest', async () => {
    console.log('[Main] IPC fetch-digest called');
    await fetchAndSummarise({ interactive: false });
    return store.get('lastDigest', null);
  });

  ipcMain.handle('get-last-digest', () => store.get('lastDigest', null));

  ipcMain.handle('connect-gmail', async () => {
    console.log('[Main] connect-gmail handler called');
    if (isFetching) {
      console.log('[Main] connect-gmail overriding in-flight fetch');
      isFetching = false;
    }
    await fetchAndSummarise({ interactive: true, forceAuth: true });
    console.log('[Main] IPC connect-gmail finished');
    return store.get('lastDigest', null);
  });
}

function setupTray() {
  tray = new Tray(createFallbackTrayImage());
  tray.setToolTip('Email Digest');
  tray.setTitle('✉️');
  tray.on('click', toggleWindow);
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  app.setLoginItemSettings({ openAtLogin: true });

  createWindow();
  setupTray();
  setupIpc();

  await fetchAndSummarise();

  cron.schedule('*/30 * * * *', () => {
    fetchAndSummarise();
  });
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('activate', () => {
  if (popupWindow) {
    toggleWindow();
  }
});
