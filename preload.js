const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Tab management
  createTab: () => ipcRenderer.invoke('create-tab'),
  closeTab: (tabId) => ipcRenderer.send('close-tab', { tabId }),

  // File operations (tab-agnostic)
  pickFile: () => ipcRenderer.invoke('pick-file'),
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),
  previewFile: (filePath) => ipcRenderer.invoke('preview-file', filePath),

  // Tab-scoped operations
  start: (tabId, options) => ipcRenderer.send('start', { tabId, ...options }),
  pause: (tabId) => ipcRenderer.send('pause', { tabId }),
  resume: (tabId) => ipcRenderer.send('resume', { tabId }),
  stop: (tabId) => ipcRenderer.send('stop', { tabId }),
  showBrowser: () => ipcRenderer.send('show-browser'), // global — affects all tabs
  captchaResponse: (tabId, text) => ipcRenderer.send('captcha-response', { tabId, text }),
  retryNA: (tabId) => ipcRenderer.send('retry-na', { tabId }),
  openOutput: (tabId) => ipcRenderer.send('open-output', { tabId }),
  newFile: (tabId) => ipcRenderer.send('new-file', { tabId }),

  // State persistence
  saveState: (state) => ipcRenderer.send('save-state', state),
  loadState: () => ipcRenderer.invoke('load-state'),

  // Main → Renderer
  onUpdate: (cb) => ipcRenderer.on('update', (_, data) => cb(data)),
  onCaptchaRequired: (cb) => ipcRenderer.on('captcha-required', (_, data) => cb(data)),
  onDone: (cb) => ipcRenderer.on('processing-done', (_, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('error', (_, data) => cb(data)),
});
