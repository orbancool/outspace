const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  minimize:         () => ipcRenderer.send('win:minimize'),
  hideToTray:       () => ipcRenderer.send('win:hideToTray'),
  close:            () => ipcRenderer.send('win:close'),
  dragStart:        () => ipcRenderer.send('win:dragStart'),
  dragEnd:          () => ipcRenderer.send('win:dragEnd'),
  resizeStart: (edge = 'se') => ipcRenderer.send('win:resizeStart', edge),
  resizeEnd:        () => ipcRenderer.send('win:resizeEnd'),
  toggleAlwaysOnTop:() => ipcRenderer.send('win:toggleAlwaysOnTop'),
  musicFetch: (source, tags, limit) => ipcRenderer.invoke('music:fetch', source, tags, limit),
  onAlwaysOnTopChanged: (cb) => {
    const listener = (_event, on) => cb(Boolean(on));
    ipcRenderer.on('win:alwaysOnTopChanged', listener);
    return () => ipcRenderer.removeListener('win:alwaysOnTopChanged', listener);
  },
});
