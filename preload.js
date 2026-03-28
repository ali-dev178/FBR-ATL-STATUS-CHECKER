const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Renderer → Main
  pickFile: () => ipcRenderer.invoke('pick-file'),
  previewFile: (filePath) => ipcRenderer.invoke('preview-file', filePath),
  start: (options) => ipcRenderer.send('start', options),
  pause: () => ipcRenderer.send('pause'),
  resume: () => ipcRenderer.send('resume'),
  stop: () => ipcRenderer.send('stop'),
  showBrowser: () => ipcRenderer.send('show-browser'),
  captchaResponse: (text) => ipcRenderer.send('captcha-response', text),
  retryNA: () => ipcRenderer.send('retry-na'),
  openOutput: () => ipcRenderer.send('open-output'),
  newFile: () => ipcRenderer.send('new-file'),

  // Main → Renderer
  onUpdate: (cb) => ipcRenderer.on('update', (_, data) => cb(data)),
  onCaptchaRequired: (cb) => ipcRenderer.on('captcha-required', (_, data) => cb(data)),
  onDone: (cb) => ipcRenderer.on('processing-done', (_, data) => cb(data)),
  onPreviewResult: (cb) => ipcRenderer.on('preview-result', (_, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('error', (_, data) => cb(data)),
  onLog: (cb) => ipcRenderer.on('log', (_, data) => cb(data)),
});
