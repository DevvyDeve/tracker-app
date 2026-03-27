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
const { mouse, keyboard } = require("@nut-tree-fork/nut-js");

const screenshotFolder = path.join(__dirname,"screenshots");

const queueFile = path.join(__dirname, "offline-queue.json");

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
let intervalSeconds = 0;
let lastActivity = Date.now();
let lastMousePosition = null;
let currentApp = "Unknown";
let currentTitle = "No active window";
let idleTriggered = false;
let isTracking = false;

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

console.log("APP STARTED 🔥");

function getRandomTime(){
  return Math.floor(Math.random() * 300000) + 300000;
}

function startRandomScreenshots(){

  setTimeout(() => {

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

createWindow();
startRandomScreenshots();


displays = await screenshot.listDisplays();
setInterval(async () => {

try{

try{
  const keys = await keyboard.getPressedKeys();
  if(keys.length > 0){
    activityCount++;
    lastActivity = Date.now();
  }
}catch(e){}

let pos = await mouse.getPosition();

if(!lastMousePosition){
lastMousePosition = pos;
}

if(pos.x !== lastMousePosition.x || pos.y !== lastMousePosition.y){

activityCount++;
lastActivity = Date.now();

}

lastMousePosition = pos;

}catch{}

},1000);


setInterval(()=>{

let idleTime = Date.now() - lastActivity;

if(win && win.webContents){

if(idleTime > 60000){

if(!idleTriggered){
  idleTriggered = true;

    console.log("⚠️ USER IDLE");

    if(win && win.webContents){
      win.webContents.send("status-update","idle");
    }
  }

}else{

  if(idleTriggered){
    console.log("✅ USER ACTIVE AGAIN");
  }

  idleTriggered = false;

  if(win && win.webContents){
    win.webContents.send("status-update","active");
  }

}

}

},5000);

setInterval(()=>{

if(!idleTriggered && isTracking){
  intervalSeconds++;
}

},1000);


let activityHistory = [];

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

  fs.writeFileSync(queueFile, JSON.stringify(newQueue));

}, 15000);


});

ipcMain.on("trigger-screenshot", async ()=>{

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


if(displays.length === 0) return;

let display = displays[currentMonitor];

let monitorName = display.id.replace(/[^a-zA-Z0-9]/g,"");
const img = await screenshot({ screen: display.id });
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

try{

  if(!isTracking || idleTriggered){
  return;
}

let activityPercent = 0;

if(activityHistory.length >= 3){
  const total = activityHistory.reduce((a,b)=>a+b,0);
  activityPercent = Math.min(Math.floor(total * 10), 100);
}

if(win && win.webContents){
  win.webContents.send("activity-update", activityPercent);
}

const imageBuffer = fs.readFileSync(filePath);
const base64Image = imageBuffer.toString("base64");

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
})

console.log("Upload success:", activityPercent + "% activity");

fs.unlinkSync(filePath);
activityCount = 0;

}catch(err){

  console.log("Upload error:", err.message);

  // 👉 SAVE TO OFFLINE QUEUE
  const queue = JSON.parse(fs.readFileSync(queueFile));

  queue.push({
    filePath: filePath,
    sessionId: sessionId,
    userId: userId,
    activity: activityPercent,
    app: currentApp,
    title: currentTitle
  });

  fs.writeFileSync(queueFile, JSON.stringify(queue));

}

}

ipcMain.on("login-success",(event,data)=>{

  userId = data.user
  token = data.token
  isTracking = true;
  let userName = data.name
  console.log("User logged in:",userId);

    (async () => {
  try {
    const response = await axios.post(
      API_URL + "/start-session",
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    sessionId = response.data.session_id;
    sessionDate = new Date().toDateString();

    console.log("AUTO SESSION START:", sessionId);

  } catch(err) {
    console.log("Auto start failed:", err.message);
  }
})();

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

ipcMain.on("logout", ()=>{

  sessionId = null;
  userId = null;
  token = null;

  win.loadFile("login.html");

});

ipcMain.on("start-tracking", ()=>{
  isTracking = true;
});

ipcMain.on("stop-tracking", ()=>{
  isTracking = false;
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