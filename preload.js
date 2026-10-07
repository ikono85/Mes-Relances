const { contextBridge, ipcRenderer } = require('electron');
const call = ch => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  load: call('load'),
  save: call('save'),
  openExternal: call('openExternal'),
  setTheme: call('setTheme'),
  getAutoStart: call('getAutoStart'),
  setAutoStart: call('setAutoStart'),
  dataPath: call('dataPath'),
  checkReminders: call('checkReminders'),
  docPick: call('docPick'),
  docOpen: call('docOpen'),
  docShow: call('docShow'),
  docDelete: call('docDelete'),
  readCsv: call('readCsv'),
  pickDir: call('pickDir'),
  backupNow: call('backupNow'),
  backupStatus: call('backupStatus'),
  backupOpen: call('backupOpen'),
  backupRestore: call('backupRestore'),
  exportJson: call('export'),
  exportCsv: call('exportCsv'),
  pdf: call('pdf'),
  importJson: call('import')
});
