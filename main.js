const { autoUpdater } = require("electron-updater");
const log = require("electron-log");

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = "info";

let sessionId = null;
let recoveredSession = false;
let sessionStartTime = null;
let totalWorkedSeconds = 0;
let sessionDate = null;
let userId = null;
let token = null;
let intervals = [];
let selectedEmployer = null;
let userName = null;  
let userEmail = null; 
let userAvatar = null;


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
const timeFile = path.join(userDataPath, "time.json");

// create file if not exists
if (!fs.existsSync(queueFile)) {
  fs.writeFileSync(queueFile, JSON.stringify([]));
}

if (!fs.existsSync(screenshotFolder)) {
fs.mkdirSync(screenshotFolder, { recursive: true });
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
function saveLocalTime(){
  const data = {
    totalWorkedSeconds,
    sessionDate,
    sessionId,
    sessionStartTime, 
    wasTracking: isTracking
  };
  fs.writeFileSync(timeFile, JSON.stringify(data));
}

function loadLocalTime(){

  if (!fs.existsSync(timeFile)) return;

  try{
    const data = JSON.parse(fs.readFileSync(timeFile));

    const todayUTC = new Date().toLocaleDateString('en-CA');

const todayLocal = new Date().toLocaleDateString('en-CA');

if(data.sessionDate === todayLocal){
  totalWorkedSeconds = data.totalWorkedSeconds || 0;
  sessionDate = data.sessionDate;
  sessionId = data.sessionId || null;
  sessionStartTime = null;
  isTracking = data.wasTracking || false;

  console.log("✅ Restored timer:", totalWorkedSeconds);

}else{
  console.log("🌅 New day → reset timer");

  totalWorkedSeconds = 0;
  sessionDate = todayLocal;
  saveLocalTime();
}

  }catch(err){
    console.log("Load time error:", err.message);
  }
}

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
loadLocalTime();

// ✅ FIX: Check for updates once lang sa startup
setTimeout(() => {
  console.log("🚀 STARTING AUTO UPDATE CHECK...");
  autoUpdater.checkForUpdatesAndNotify();
}, 5000);

function getRandomTime(){
  return Math.floor(Math.random() * (600000 - 420000)) + 420000;
}

intervals.push(setInterval(()=>{
  if(isTracking && sessionId){
    saveWorkedTime();
    saveLocalTime();
  }
},120000));

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
      if(win && !win.isDestroyed()){
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

let idleChecker = setInterval(async ()=>{
  const systemIdle = powerMonitor.getSystemIdleTime();
  const manualIdle = (Date.now() - lastActivityTime) / 1000; // 🔥 fallback
  let idleTime;

  if(manualIdle < 5){
    idleTime = manualIdle;
  }else{
    idleTime = systemIdle;
  }
  console.log("Idle:", idleTime);
if(idleTime >= 120 && isTracking && !idleTriggered){

    idleTriggered = true;

    totalWorkedSeconds = getCurrentTotalSeconds();
    sessionStartTime = null;
    

    // ✅ FIX: I-save muna bago mag-idle para walang nawalang oras
    saveWorkedTime();
    saveLocalTime();
    isTracking = false;
    console.log("⚠️ USER IDLE");

    if(win && !win.isDestroyed()){
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

// 🔥 START TIMER ONLY IF SESSION EXISTS
if(sessionId){
  isTracking = true;
}else{
  return; // 🚫 DO NOT START WITHOUT SESSION
}

  // ✅ restart timer properly
  sessionStartTime = Date.now();

  if(win && !win.isDestroyed()){
    win.webContents.send("status-update","active");
    win.webContents.send("resume-tracking");
    win.setAlwaysOnTop(false);

    win.webContents.send("session-data", {
      start: sessionStartTime,
      total: totalWorkedSeconds
    });
  }
}

}, 3000);


intervals.push(setInterval(()=>{
if(!idleTriggered && isTracking){
  intervalSeconds++;
}
},1000));

intervals.push(setInterval(()=>{

  if(isTracking){

let currentSeconds = getCurrentTotalSeconds();


    if(win && !win.isDestroyed()){
      win.webContents.send("timer-update", currentSeconds);
    }

  }

},1000));

intervals.push(setInterval(()=>{

  if(!idleTriggered && isTracking){
    activityHistory.push(activityCount);

    if(activityHistory.length > 10){
      activityHistory.shift(); // keep last 10 seconds
    }

    activityCount = 0;
  }

},1000));

let queueRetry = setInterval(async () => {

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
    const today = new Date().toLocaleDateString('en-CA');

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
  if(!token || !sessionId) return;
console.log("🚀 Upload function called");

  // ✅ FIX: Declare sa labas ng try para ma-access sa catch
  let activityPercent = 0;

try{

  if(!isTracking || idleTriggered){
  return;
}

activityPercent = Math.min(Math.floor(totalActivity * 4), 100);

if(win && !win.isDestroyed()){
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

    if(win && !win.isDestroyed()){
      win.loadFile("login.html");
    }

    return;
  }

  console.log("Upload error:", err.message);
}

if(success){
  console.log("Upload success:", activityPercent + "% activity");
}

totalActivity = 0;

if(fs.existsSync(filePath)){
  fs.unlinkSync(filePath);
}
activityCount = 0;

}catch(err){

  console.log("Upload error:", err.message);

  // ✅ FIX: I-reset ang activity counter kahit offline
  totalActivity = 0;
  activityCount = 0;

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

ipcMain.on("login-success", async (event, data) => {
  userId = data.user
  token = data.token
  isTracking = false;
  lastActivity = Date.now();
  idleTriggered = false;
  userName = data.name
  userEmail = data.email;
  userAvatar = data.avatar;
  console.log("User logged in:", userId);

  // 🔥 BAGONG CODE — Fetch employers after login
  try {
    const empResponse = await axios.get(API_URL + "/get-employers", {
      headers: { Authorization: `Bearer ${token}` }
    });

    const employers = empResponse.data;

    // Kung isa lang ang employer — automatic na ang selection
    if(employers.length === 1){
      selectedEmployer = employers[0];
      console.log("✅ Auto-selected employer:", selectedEmployer.employer_name);

      // ✅ ORIGINAL CODE MO — nandito pa rin
      const todayUTC = new Date().toLocaleDateString('en-CA');
      if(!sessionDate){
        sessionDate = todayUTC;
        saveLocalTime();
      }

      // ✅ ORIGINAL CODE MO — session check
      if(sessionId && token && isTracking){
        console.log("♻️ Checking session after login...");
        axios.post(API_URL + "/update-time", {
          session_id: sessionId,
          total_seconds: totalWorkedSeconds
        },{
          headers:{ Authorization:`Bearer ${token}` }
        })
        .then(()=>{
          console.log("✅ Session valid → resuming");
          if(isTracking){
            sessionStartTime = Date.now();
          }
          if(sessionId){
            isTracking = true;
          }else{
            return;
          }
        })
        .catch((err)=>{
          console.log("❌ Session invalid → reset", err.message);
          sessionId = null;
          isTracking = false;
          saveLocalTime();
          if(win && !win.isDestroyed()){
            win.webContents.send("force-stop");
            win.webContents.send("status-update","idle");
          }
        });
      }

      console.log("👉 LOADING INDEX");
      win.loadFile("index.html");
      win.webContents.once("did-finish-load", ()=>{
        win.webContents.send("user-data", {
          userId: userId,
          name: userName,
          email: userEmail,
          avatar: userAvatar
        });
        win.webContents.send("session-data", {
          start: sessionStartTime,
          total: totalWorkedSeconds
        });
      });

    } else {
      // Kung 2+ employers — ipakita ang employer selector screen
      console.log("👥 Multiple employers found:", employers.length);

      // ✅ ORIGINAL CODE MO — session date check
      const todayUTC = new Date().toLocaleDateString('en-CA');
      if(!sessionDate){
        sessionDate = todayUTC;
        saveLocalTime();
      }

      win.loadFile("employer-select.html");
      win.webContents.once("did-finish-load", () => {
        win.webContents.send("employer-list", employers);
      });
    }

  } catch(err) {
    console.log("❌ Failed to fetch employers:", err.message);

    if(err.response && err.response.status === 404){
      console.log("❌ No active employers found");
      if(win && !win.isDestroyed()){
        win.loadFile("login.html");
        win.webContents.once("did-finish-load", () => {
          win.webContents.executeJavaScript(`
            document.getElementById("status").innerText = 
            "❌ No active employer found. Please contact your employer.";
          `);
        });
      }
      return;
    }

    // ✅ FALLBACK — kung may error sa fetch, ituloy ang normal flow
    const todayUTC = new Date().toLocaleDateString('en-CA');
    if(!sessionDate){
      sessionDate = todayUTC;
      saveLocalTime();
    }

    console.log("👉 LOADING INDEX (fallback)");
    win.loadFile("index.html");
    win.webContents.once("did-finish-load", ()=>{
      win.webContents.send("user-data", {
        userId: userId,
        name: userName,
        email: userEmail,
        avatar: userAvatar
      });
      win.webContents.send("session-data", {
        start: sessionStartTime,
        total: totalWorkedSeconds
      });
    });
  }
});

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



// 🔥 BAGONG HANDLER — idagdag bago ang logout handler
ipcMain.on("select-employer", async (event, employer) => {
  selectedEmployer = employer;
  console.log("✅ Employer selected:", selectedEmployer.employer_name);

  const todayUTC = new Date().toLocaleDateString('en-CA');
  if(!sessionDate){
    sessionDate = todayUTC;
    saveLocalTime();
  }

  win.loadFile("index.html");
  win.webContents.once("did-finish-load", () => {
    win.webContents.send("user-data", {
      userId: userId,
      name: userName,   // ✅ name ng worker
      email: userEmail, // ✅ email ng worker
      avatar: userAvatar || ""
    });
    win.webContents.send("session-data", {
      start: sessionStartTime,
      total: totalWorkedSeconds
    });
  });
});

ipcMain.on("logout", async ()=>{

  selectedEmployer = null;
  userName = null;   
  userEmail = null; 
  userAvatar = null;
  saveWorkedTime();

  if(sessionId && token && isTracking){
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

// KEEP DATA — DO NOT RESET TIMER
sessionId = null;
if(sessionStartTime){
  sessionStartTime = null; // OK dito
}
saveLocalTime();

  userId = null;
  token = null;

  win.loadFile("login.html");

clearInterval(idleChecker);
  clearInterval(queueRetry);
  intervals.forEach(clearInterval);
  intervals = [];
});

app.on("before-quit", async ()=>{
  totalWorkedSeconds = getCurrentTotalSeconds();
  sessionStartTime = null;
  saveWorkedTime();
  saveLocalTime();
  if(sessionId && token && isTracking){
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

  const today = new Date().toLocaleDateString('en-CA');

  // 🔥 NEW DAY CHECK
  if(sessionDate !== today){

    console.log("🌅 New day → reset session");

    if(sessionId){
      try{
        await axios.post(
          API_URL + "/end-session",
          { session_id: sessionId },
          { headers:{ Authorization:`Bearer ${token}` } }
        );
      }catch(err){
        console.log("Auto end error:", err.message);
      }
    }

    sessionId = null;
    totalWorkedSeconds = 0;
    sessionDate = today;

    saveLocalTime();
  }

  // 🔥 CREATE NEW SESSION
  if(!sessionId){
    try{
      const response = await axios.post(
        API_URL + "/start-session",
        { 
          job_id: selectedEmployer ? selectedEmployer.job_id : 1,
          employer_id: selectedEmployer ? selectedEmployer.employer_id : null
        },
        { headers:{ Authorization:`Bearer ${token}` } }
      );

      console.log("🔥 START SESSION RESPONSE:", response.data);

      if(!response.data.session_id){
  console.log("❌ SESSION FAILED:", response.data);

  isTracking = false;

  if(win && !win.isDestroyed()){
    win.webContents.send("force-stop");
  }

  return;
}

sessionId = response.data.session_id;
      sessionDate = today;

      console.log("✅ NEW SESSION:", sessionId);

      saveLocalTime();

    }catch(err){
      console.log("❌ FULL ERROR:", err.response?.data || err.message);

      isTracking = false;

      if(win && !win.isDestroyed()){
        win.webContents.send("force-stop");
      }

      return;
    }
  }

// 🔥 START TIMER ONLY IF SESSION EXISTS
if(sessionId){
  isTracking = true;
}else{
  return; // 🚫 DO NOT START WITHOUT SESSION
}

  if(!sessionStartTime){
  sessionStartTime = Date.now();
}

  lastActivityTime = Date.now(); // 🔥 RESET IDLE
idleTriggered = false;         // 🔥 RESET IDLE STATE

  if(win && !win.isDestroyed()){
    win.webContents.send("status-update","active");
  }

  

});

ipcMain.on("stop-tracking", async ()=>{

  // ✅ FIX: I-snapshot at i-save BAGO i-set ang isTracking=false
  totalWorkedSeconds = getCurrentTotalSeconds();
  sessionStartTime = null;

  saveWorkedTime();           // ← tatakbo na ngayon dahil isTracking still true
  saveLocalTime();

  isTracking = false;         // ← dito na lang sa dulo


  if(win && !win.isDestroyed()){
    win.webContents.send("status-update","idle");
  }

});

ipcMain.on("user-activity", ()=>{
  lastActivity = Date.now();
  lastActivityTime = Date.now(); 

  if(idleTriggered){

    if(win && !win.isDestroyed()){
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
lastActivityTime = Date.now(); // 🔥 THIS FIXES IDLE FALSE TRIGGER
  console.log("🖱️ Total Activity:", totalActivity);
});


function getCurrentTotalSeconds(){
  let total = totalWorkedSeconds;

  if(isTracking && sessionStartTime){
    const now = Date.now();
    const diff = Math.floor((now - sessionStartTime) / 1000);
    total += diff;
  }

  return total;
}

let isSaving = false;

async function saveWorkedTime(){

  if(!sessionId || !token || !isTracking) return;
  if(isSaving) return; // 🔥 iwas sabay-sabay

  isSaving = true;

  let currentSeconds = getCurrentTotalSeconds();

  try{
    await axios.post(API_URL + "/update-time", {
      session_id: sessionId,
      total_seconds: currentSeconds
    },{
      headers:{
        Authorization:`Bearer ${token}`
      },
      timeout: 20000 // 🔥 dagdag time (20 seconds)
    });

  }catch(err){
    console.log("❌ Save time error:", err.code || err.message);
  }

  isSaving = false;
}

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

