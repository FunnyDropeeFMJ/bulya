const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skin', {
  get: () => ipcRenderer.invoke('skin:get'),
  save: (s) => ipcRenderer.invoke('skin:save', s),
  sprite: (name) => ipcRenderer.invoke('sprite', name)
});
