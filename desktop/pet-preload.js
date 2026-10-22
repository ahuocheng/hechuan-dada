const { contextBridge, ipcRenderer } = require('electron');

// 桌宠窗口只拿到自己用的这几个接口
contextBridge.exposeInMainWorld('pet', {
  dragStart: () => ipcRenderer.send('pet:dragStart'),
  dragEnd: () => ipcRenderer.send('pet:dragEnd'),
  layout: size => ipcRenderer.invoke('pet:layout', size),
  recognize: text => ipcRenderer.invoke('pet:recognize', text),
  clipboard: () => ipcRenderer.invoke('pet:clipboard'),
  add: list => ipcRenderer.invoke('pet:add', list),
  open: data => ipcRenderer.invoke('pet:open', data),
  hide: () => ipcRenderer.invoke('pet:hide'),
  status: () => ipcRenderer.invoke('pet:status'),
  toggleWidget: () => ipcRenderer.invoke('pet:toggleWidget'),
  getTheme: () => ipcRenderer.invoke('pet:getTheme'),
  onTheme: cb => ipcRenderer.on('pet:theme', (_e, t) => cb(t)),
  onCursor: cb => ipcRenderer.on('pet:cursor', (_e, p) => cb(p)),
  onRefresh: cb => ipcRenderer.on('pet:refresh', () => cb()),
  onAlert: cb => ipcRenderer.on('pet:alert', (_e, a) => cb(a))
});
