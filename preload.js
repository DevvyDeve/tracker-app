const { contextBridge, ipcRenderer } = require("electron");

const validSendChannels = [
  "login-success", "start-tracking", "stop-tracking",
  "end-session", "logout", "user-activity", "increment-activity",
  "trigger-screenshot", "select-employer"
];

const validReceiveChannels = [
  "timer-update", "status-update", "force-stop", "app-update",
  "user-data", "session-data", "activity-update",
  "idle-popup", "resume-tracking", "trigger-screenshot",
  "show-employer-select", "employer-list"
];

contextBridge.exposeInMainWorld("api", {

  send: (channel, data) => {
    if(validSendChannels.includes(channel)){
      ipcRenderer.send(channel, data);
    }
  },

  on: (channel, func) => {
    if(validReceiveChannels.includes(channel)){
      ipcRenderer.removeAllListeners(channel);
      ipcRenderer.on(channel, func);
    }
  },

  receive: (channel, func) => {
    if(validReceiveChannels.includes(channel)){
      ipcRenderer.removeAllListeners(channel);
      ipcRenderer.on(channel, func);
    }
  }

});