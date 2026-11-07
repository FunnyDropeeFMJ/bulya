const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('brain:get'),
  test: (cfg, key) => ipcRenderer.invoke('brain:test', cfg, key),
  models: (baseUrl, key, provider) => ipcRenderer.invoke('brain:models', baseUrl, key, provider),
  save: (cfg, key) => ipcRenderer.invoke('brain:save', cfg, key),
  openUrl: (url) => ipcRenderer.send('open-link', url)
});
