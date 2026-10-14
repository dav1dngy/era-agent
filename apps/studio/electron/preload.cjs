// Preload (sandboxed renderer). The page gets exactly three capabilities and nothing else: no Node, no fs, no shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eraDesktop', {
  // The main process attaches the control-plane token to this window's requests; the page never holds it.
  injectedAuth: true,
  platform: process.platform,
  // Native file/folder picker. Returns an absolute path or null; the control plane still enforces what may be used.
  pickPath: () => ipcRenderer.invoke('era:pick-path'),
  version: () => ipcRenderer.invoke('era:version'),
});
