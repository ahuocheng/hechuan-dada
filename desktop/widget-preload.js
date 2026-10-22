const { contextBridge, ipcRenderer } = require('electron');

// 桌面小组件窗口只拿到自己用的这几个接口（每个小组件一个窗口）
contextBridge.exposeInMainWorld('widget', {
  getConfig: () => ipcRenderer.invoke('widget:getConfig'),
  setConfig: patch => ipcRenderer.invoke('widget:setConfig', patch),
  data: () => ipcRenderer.invoke('widget:data'),
  resize: size => ipcRenderer.send('widget:resize', size),
  dragStart: () => ipcRenderer.send('widget:dragStart'),
  dragEnd: () => ipcRenderer.send('widget:dragEnd'),
  toggleDone: id => ipcRenderer.invoke('widget:toggleDone', id),
  open: item => ipcRenderer.invoke('widget:open', item),
  edit: () => ipcRenderer.invoke('widget:edit'),
  remove: () => ipcRenderer.invoke('widget:remove'),
  onRefresh: cb => ipcRenderer.on('widget:refresh', () => cb()),
  onConfig: cb => ipcRenderer.on('widget:config', (_e, c) => cb(c)),
  onFlash: cb => ipcRenderer.on('widget:flash', () => cb()),
  onTheme: cb => ipcRenderer.on('app:theme', (_e, t) => cb(t))
});
