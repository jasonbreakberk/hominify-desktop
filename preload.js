const { ipcRenderer } = require('electron');

// Context isolation kapalı olduğu için doğrudan window'a ekliyoruz
window.electron = {
  ipcRenderer
};
