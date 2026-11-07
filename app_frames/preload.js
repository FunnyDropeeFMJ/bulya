const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bulya', {
  send: (text, paths = []) => ipcRenderer.invoke('send', text, paths),
  setHotZones: (rects) => ipcRenderer.send('hot-zones', rects),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  noticeAction: (id) => ipcRenderer.send('notice-action', id),
  openSettings: () => ipcRenderer.send('open-settings'),
  spriteData: (name) => ipcRenderer.invoke('sprite', name),
  moveBy: (dx, dy) => ipcRenderer.send('move-by', { dx, dy }),
  strollStep: (dx) => ipcRenderer.invoke('stroll-step', dx),
  setDragging: (on) => ipcRenderer.send('dragging', !!on),
  petMenu: () => ipcRenderer.send('pet-menu'),
  relayout: () => ipcRenderer.send('relayout'),
  layoutDone: () => ipcRenderer.send('layout-done'),
  openLink: (url) => ipcRenderer.send('open-link', url),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  onChatEvent: (cb) => ipcRenderer.on('chat-event', (_e, ev) => cb(ev))
});
