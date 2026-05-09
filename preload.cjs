const { contextBridge, ipcRenderer } = require('electron');

console.log('[Preload] preload loaded');

contextBridge.exposeInMainWorld('electronAPI', {
  fetchDigest: () => ipcRenderer.invoke('fetch-digest'),
  getLastDigest: () => ipcRenderer.invoke('get-last-digest'),
  connectGmail: () => {
    console.log('[Preload] connectGmail called');
    return ipcRenderer.invoke('connect-gmail');
  },
  onDigestUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('digest-update', listener);
    return () => ipcRenderer.removeListener('digest-update', listener);
  }
});