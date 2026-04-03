const { autoUpdater } = require("electron-updater");
const log = require("electron-log");

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = "info";

let sessionId = null;
let sessionDate = null;
let userId = null
let token = null


const API_URL = "https://vajobmarketplace.com/wp-json/worktracker/v1";

const { app, BrowserWindow, ipcMain } = require("electron");
const screenshot = require("screenshot-desktop");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { powerMonitor } = require("electron");
const userDataPath = app.getPath("userData");
const screenshotFolder = path.join(userDataPath, "screenshots");
const queueFile = path.join(userDataPath, "offline-queue.json");

// create file if not exists
if (!fs.existsSync(queueFile)) {
  fs.writeFileSync(queueFile, JSON.stringify([]));
}

if (!fs.existsSync(screenshotFolder)) {
fs.mkdirSync(screenshotFolder);
}

let win;
let displays = [];
let currentMonitor = 0;
let activityCount = 0;
let totalActivity = 0;
let lastActivityTick = Date.now();
let intervalSeconds = 0;
let lastActivity = Date.now();
let lastMousePosition = null;
let currentApp = "Unknown";
let currentTitle = "No active window";
let idleTriggered = false;
let isTracking = false;
let activityHistory = [];
let lastActivityTime = Date.now(); 

function getProductivityType(app, title){

  const productiveApps = ["code", "visual studio", "figma", "notepad"];
  const unproductiveApps = ["youtube", "facebook", "netflix"];

  const text = (app + " " + title).toLowerCase();

  if(productiveApps.some(a => text.includes(a))){
    return "productive";
  }

  if(unproductiveApps.some(a => text.includes(a))){
    return "unproductive";
  }

  return "neutral";
}


function createWindow() {

win = new BrowserWindow({
width:500,
height:700,
webPreferences:{
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true,
  nodeIntegration: false
}
});

win.loadFile("login.html");

}


app.whenReady().then(async ()=>{

function getRandomTime(){
  return Math.floor(Math.random() * (600000 - 420000)) + 420000;
}

function startRandomScreenshots(){

  setTimeout(() => {
console.log("⏱️ Timer fired");

if(sessionId && isTracking && !idleTriggered){
  console.log("📸 READY TO TAKE SCREENSHOT");
}else{
  console.log("❌ NOT READY", {
    sessionId,
    isTracking,
    idleTriggered
  });
}
    if(sessionId && isTracking && !idleTriggered){
      console.log("📸 RANDOM SCREENSHOT TRIGGER");

      // 👉 trigger existing screenshot system mo
      if(win && win.webContents){
        win.webContents.send("trigger-screenshot");
      }
    }

    startRandomScreenshots(); // loop

  }, getRandomTime());

  

}

const { screen } = require("electron");

console.log("🚀 App ready");

displays = screen.getAllDisplays();

console.log("🖥️ Displays detected:", displays.length);
createWindow();
startRandomScreenshots();

setInterval(()=>{
  const systemIdle = powerMonitor.getSystemIdleTime(); // system
  const manualIdle = (Date.now() - lastActivityTime) / 1000; // 🔥 fallback
  let idleTime;

  if(manualIdle < 5){
    idleTime = manualIdle;
  }else{
    idleTime = systemIdle;
  }
  console.log("Idle:", idleTime);
  if(idleTime >= 60 && isTracking && !idleTriggered){

    idleTriggered = true;

    console.log("⚠️ USER IDLE");

    if(win){
      win.webContents.send("status-update","idle"); 
      win.webContents.send("force-stop");
      win.show();
      win.focus();
      win.setAlwaysOnTop(true);
      win.webContents.send("idle-popup");
    }
  }

  if(idleTime < 5 && idleTriggered){
    console.log("🔥 USER ACTIVE AGAIN");
    idleTriggered = false;
    if(win){
      win.webContents.send("status-update","active");
      win.webContents.send("resume-tracking");
      win.setAlwaysOnTop(false);
    }

  }

}, 3000);


setInterval(()=>{
if(!idleTriggered && isTracking){
  intervalSeconds++;
}
},1000);


setInterval(()=>{

  if(!idleTriggered && isTracking){
    activityHistory.push(activityCount);

    if(activityHistory.length > 10){
      activityHistory.shift(); // keep last 10 seconds
    }

    activityCount = 0;
  }

},1000);

setInterval(async () => {

  let queue = JSON.parse(fs.readFileSync(queueFile));

  if(queue.length === 0) return;

  console.log("Retrying offline uploads:", queue.length);

  let newQueue = [];

  for(let item of queue){

    try{

        if(!fs.existsSync(item.filePath)){
        console.log("Missing file, skipping...");
        continue;
        }
      const imageBuffer = fs.readFileSync(item.filePath);
      const base64Image = imageBuffer.toString("base64");

      await axios.post(API_URL + "/upload-screenshot",
      {
        session_id: item.sessionId,
        activity_percent: item.activity,
        screenshot: base64Image,
        app_name: item.app,
        window_title: item.title
      },
      {
        headers:{
          Authorization:`Bearer ${token}`
        }
      });

      console.log("Recovered upload success");

      fs.unlinkSync(item.filePath);

    }catch(err){

      newQueue.push(item);

    }

  }

fs.writeFileSync(queueFile, JSON.stringify(newQueue, null, 2));

}, 15000);


});

ipcMain.on("trigger-screenshot", async ()=>{
console.log("📥 IPC trigger-screenshot received");
    const today = new Date().toDateString();

if(sessionId && sessionDate !== today){

  console.log("New day detected → starting new session");

  // end old session
  try{
    await axios.post(API_URL + "/end-session",
    { session_id: sessionId },
    { headers:{ Authorization:`Bearer ${token}` } }
    );
  }catch(err){
    console.log("Auto end failed:", err.message);
  }

  sessionId = null;
  sessionDate = today;

}

try{

console.log("📸 Taking screenshot...");
if(displays.length === 0){
  console.log("❌ NO DISPLAYS FOUND");
  return;
}

let display = displays[currentMonitor];

let monitorName = String(display.id).replace(/[^a-zA-Z0-9]/g,"");
const img = await screenshot({ screen: display.id.toString() });
const fileName = `${Date.now()}-${monitorName}.jpg`;
const filePath = path.join(screenshotFolder,fileName);

if(isSensitive(currentApp, currentTitle)){

  console.log("Sensitive detected → BLUR");

  await sharp(img)
    .resize(1280)
    .blur(20) // 👉 blur strength
    .jpeg({ quality:60 })
    .toFile(filePath);

}else{

  await sharp(img)
    .resize(1280)
    .jpeg({ quality:60 })
    .toFile(filePath);

}
if(sessionId && isTracking && !idleTriggered){
  await uploadScreenshot(filePath);
  console.log("📸 Screenshot captured:", filePath);
}else{
  fs.unlinkSync(filePath);
}

console.log("Captured monitor:",display.id);

currentMonitor++;

if(currentMonitor >= displays.length){
currentMonitor = 0;
}

}catch(err){
console.log(err);
}

});

function isSensitive(app, title){

  const keywords = [
    "login",
    "password",
    "bank",
    "paypal",
    "gcash",
    "paymaya",
    "checkout"
  ];

  const lowerTitle = (title || "").toLowerCase();

  return keywords.some(k => lowerTitle.includes(k));
}

async function uploadScreenshot(filePath){
console.log("🚀 Upload function called");
try{

  if(!isTracking || idleTriggered){
  return;
}

let activityPercent = Math.min(Math.floor(totalActivity * 4), 100);

if(win && win.webContents){
  win.webContents.send("activity-update", activityPercent);
}

const imageBuffer = fs.readFileSync(filePath);
const base64Image = imageBuffer.toString("base64");

let success = false;

try{
console.log("📤 Uploading...");
console.log("Session:", sessionId);
console.log("Activity:", activityPercent);
  await axios.post(API_URL + "/upload-screenshot",
  {
    session_id: sessionId,
    activity_percent: activityPercent,
    screenshot: base64Image,
    app_name: currentApp,
    window_title: currentTitle
  },
  {
    headers:{
      Authorization:`Bearer ${token}`
    }
  });

  success = true;

}catch(err){
console.log("❌ Upload error FULL:", err.response?.data || err.message);
  if(err.response && err.response.status === 401){

    console.log("❌ TOKEN EXPIRED → LOGOUT");

    sessionId = null;
    userId = null;
    token = null;
    isTracking = false;

    if(win){
      win.loadFile("login.html");
    }

    return;
  }

  console.log("Upload error:", err.message);
}

if(success){
  console.log("Upload success:", activityPercent + "% activity");
}

if(fs.existsSync(filePath)){
  fs.unlinkSync(filePath);
}
activityCount = 0;

}catch(err){

  console.log("Upload error:", err.message);

const queue = JSON.parse(fs.readFileSync(queueFile));

if(fs.existsSync(filePath)){
  queue.push({
    filePath: filePath,
    sessionId: sessionId,
    userId: userId,
    activity: activityPercent,
    app: currentApp,
    title: currentTitle
  });
}else{
  console.log("File missing, not added to queue");
}

if(queue.length > 50){
  const removed = queue.shift();

  // delete old file para hindi mag accumulate
  if(removed && fs.existsSync(removed.filePath)){
    fs.unlinkSync(removed.filePath);
  }
}

fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2));
}

}

ipcMain.on("login-success",(event,data)=>{
  userId = data.user
  token = data.token
  isTracking = true;
  lastActivity = Date.now();
  idleTriggered = false;
  let userName = data.name
  console.log("User logged in:",userId);

  win.loadFile("index.html")

  // 👉 SEND USER DATA SA FRONTEND
  win.webContents.on("did-finish-load", ()=>{
    win.webContents.send("user-data", {
    userId: userId,
    name: userName
    });
  });

  setTimeout(() => {
  console.log("🚀 STARTING AUTO UPDATE CHECK...");
  autoUpdater.checkForUpdatesAndNotify();
}, 3000);

})

ipcMain.on("end-session", async () => {

  if(!sessionId) return;

  try {

    await axios.post(API_URL + "/end-session",
    {
      session_id: sessionId
    },
    {
      headers:{
        Authorization:`Bearer ${token}`
      }
    });

    console.log("Session ended");
    isTracking = false;
sessionId = null;

  } catch(err){
    console.log("End session error:", err.message);
  }

});

ipcMain.on("logout", async ()=>{
  if(sessionId){
    try{
      await axios.post(API_URL + "/end-session",
      { session_id: sessionId },
      {
        headers:{ Authorization:`Bearer ${token}` }
      });

      console.log("🔚 Session ended (logout)");

    }catch(err){
      console.log("Logout end error:", err.message);
    }
  }
  sessionId = null;
  userId = null;
  token = null;
  win.loadFile("login.html");
});

app.on("before-quit", async ()=>{
  if(sessionId){
    try{
      await axios.post(API_URL + "/end-session",
      { session_id: sessionId },
      {
        headers:{ Authorization:`Bearer ${token}` }
      });
      console.log("💀 Session ended (app close)");
    }catch(err){
      console.log("Close end error:", err.message);
    }
  }

});

ipcMain.on("start-tracking", async ()=>{
  isTracking = true;

  if(!sessionId){
    try{
      const response = await axios.post(
        API_URL + "/start-session",
        {},
        {
          headers:{ Authorization:`Bearer ${token}` }
        }
      );
      sessionId = response.data.session_id;
      sessionDate = new Date().toDateString();

    }catch(err){
      console.log("Start session error:", err.message);
    }
  }
  if(idleTriggered){
    idleTriggered = false;
    lastActivity = Date.now();

    if(win){
      win.webContents.send("status-update","active");
      win.webContents.send("resume-tracking");
      win.setAlwaysOnTop(false);
    }
  }

});

ipcMain.on("stop-tracking", async ()=>{
  isTracking = false;
  if(!sessionId) return;
  try{
    await axios.post(API_URL + "/end-session",
    { session_id: sessionId },
    {
      headers:{ Authorization:`Bearer ${token}` }
    });
    sessionId = null;
  }catch(err){
    console.log("Pause end error:", err.message);
  }
});

ipcMain.on("user-activity", ()=>{
  lastActivity = Date.now();
  lastActivityTime = Date.now(); 

  if(idleTriggered){
    console.log("🔥 USER IS ACTIVE AGAIN");

    idleTriggered = false;
    isTracking = true;

    if(win){
      win.webContents.send("status-update","active");
      win.webContents.send("resume-tracking");
      win.setAlwaysOnTop(false);
    }
  }
});

ipcMain.on("increment-activity", ()=>{
  const now = Date.now();

  if(now - lastActivityTick > 200){
    totalActivity++;
    lastActivityTick = now;
  }

  console.log("🖱️ Total Activity:", totalActivity);
});


autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});

autoUpdater.on('update-available', () => {
  console.log('Update available.');
});

autoUpdater.on('update-not-available', () => {
  console.log('No updates.');
});

autoUpdater.on('error', (err) => {
  console.log('Update error:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log('Downloading update:', progressObj.percent);
});

autoUpdater.on('update-downloaded', () => {
  console.log('Update downloaded. Installing...');
  autoUpdater.quitAndInstall();
});