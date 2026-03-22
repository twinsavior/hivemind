const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hivemind', {
  sendTask: (description, agentId) => ipcRenderer.invoke('send-task', { description, agentId }),
  getAgents: () => ipcRenderer.invoke('get-agents'),
  getHealth: () => ipcRenderer.invoke('get-health'),
  getMetrics: () => ipcRenderer.invoke('get-metrics'),
  onServerLog: (callback) => ipcRenderer.on('server-log', (_e, log) => callback(log)),
  onServerStatus: (callback) => ipcRenderer.on('server-status', (_e, status) => callback(status)),

  // Folder / repo picker
  browseFolder: () => ipcRenderer.invoke('browse-folder'),
  setFolder: (path) => ipcRenderer.invoke('set-folder', path),
  getRecentFolders: () => ipcRenderer.invoke('get-recent-folders'),
  getActiveFolder: () => ipcRenderer.invoke('get-active-folder'),

  // Image / file attachments
  saveAttachment: (name, base64Data) => ipcRenderer.invoke('save-attachment', { name, base64Data }),
  browseImages: () => ipcRenderer.invoke('browse-images'),
});
