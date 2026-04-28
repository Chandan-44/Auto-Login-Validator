// content.js - Advanced version with CSRF token support, better waiting, and multiple submit strategies

function detectLoginForms() {
  const forms = Array.from(document.querySelectorAll('form'));
  const results = [];
  for (let form of forms) {
    let usernameField = null;
    let passwordField = null;
    let csrfField = null;
    const inputs = form.querySelectorAll('input');
    for (let inp of inputs) {
      const type = inp.type?.toLowerCase();
      const name = inp.name?.toLowerCase() || '';
      if (type === 'password') passwordField = inp;
      else if (type === 'text' || type === 'email' || name.includes('user') || name.includes('email') || name.includes('username')) {
        if (!usernameField) usernameField = inp;
      }
      // Detect CSRF token fields
      if (name.includes('csrf') || name.includes('token') || name.includes('authenticity')) {
        csrfField = inp;
      }
    }
    let submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!submitBtn) {
      submitBtn = Array.from(form.querySelectorAll('button')).find(btn => btn.type === 'submit' || btn.innerText.includes('Log in'));
    }
    if (usernameField && passwordField) {
      results.push({
        name: form.id || form.name || 'unnamed',
        fields: { 
          username: getUniqueSelector(usernameField), 
          password: getUniqueSelector(passwordField),
          csrf: csrfField ? getUniqueSelector(csrfField) : null
        },
        submitSelector: submitBtn ? getUniqueSelector(submitBtn) : null
      });
    }
  }
  return results;
}

function getUniqueSelector(el) {
  if (!el) return null;
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;
  if (el.className && typeof el.className === 'string') {
    return `${el.tagName.toLowerCase()}.${el.className.split(' ').join('.')}`;
  }
  return el.tagName.toLowerCase();
}

async function fillAndSubmitAdvanced(username, password, selectors) {
  // Find fields with flexible selectors
  let usernameEl = trySelector(selectors.username);
  let passwordEl = trySelector(selectors.password);
  
  // If not found, try common Instagram selectors
  if (!usernameEl) usernameEl = document.querySelector('input[name="username"], input[name="email"], input[type="text"]');
  if (!passwordEl) passwordEl = document.querySelector('input[type="password"]');
  
  if (!usernameEl || !passwordEl) {
    throw new Error(`Fields not found. Username: ${!!usernameEl}, Password: ${!!passwordEl}`);
  }
  
  // Get CSRF token if present
  let csrfToken = null;
  if (selectors.csrf) {
    const csrfEl = document.querySelector(selectors.csrf);
    if (csrfEl) csrfToken = csrfEl.value;
  }
  
  // Clear and fill
  usernameEl.value = '';
  passwordEl.value = '';
  usernameEl.value = username;
  passwordEl.value = password;
  
  // Trigger all possible events for React/Angular/Vue
  const events = ['input', 'change', 'blur', 'focus'];
  events.forEach(eventType => {
    usernameEl.dispatchEvent(new Event(eventType, { bubbles: true }));
    passwordEl.dispatchEvent(new Event(eventType, { bubbles: true }));
  });
  
  // Wait a bit for framework to process
  await delay(500);
  
  // Strategy 1: Find and click submit button
  let submitBtn = null;
  if (selectors.submit) submitBtn = document.querySelector(selectors.submit);
  if (!submitBtn) submitBtn = usernameEl.closest('form')?.querySelector('button[type="submit"], input[type="submit"]');
  if (!submitBtn) submitBtn = document.querySelector('button[type="submit"], button:has(span:contains("Log in")), button:has(div:contains("Log in"))');
  
  if (submitBtn) {
    submitBtn.click();
    await delay(1000);
  }
  
  // Strategy 2: Try form submit
  const form = usernameEl.closest('form');
  if (form) {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await delay(500);
    if (!submitBtn) form.submit();
  }
  
  // Wait for navigation with extended timeout
  const result = await waitForNavigationOrChange(10000);
  return result;
}

function trySelector(selector) {
  if (!selector) return null;
  try {
    return document.querySelector(selector);
  } catch(e) {
    return null;
  }
}

function waitForNavigationOrChange(maxWait = 10000) {
  return new Promise((resolve) => {
    const initialUrl = window.location.href;
    const startTime = Date.now();
    
    const checkUrl = () => {
      const currentUrl = window.location.href;
      if (currentUrl !== initialUrl) {
        resolve({ changed: true, newUrl: currentUrl });
        return true;
      }
      if (Date.now() - startTime > maxWait) {
        resolve({ changed: false, newUrl: currentUrl });
        return true;
      }
      return false;
    };
    
    // Poll for URL change
    const interval = setInterval(() => {
      if (checkUrl()) clearInterval(interval);
    }, 500);
    
    // Also watch for DOM changes (for AJAX login without full redirect)
    const observer = new MutationObserver(() => {
      checkUrl();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    
    setTimeout(() => {
      clearInterval(interval);
      observer.disconnect();
      resolve({ changed: false, newUrl: window.location.href });
    }, maxWait);
  });
}

async function getLastResponseInfo() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getLastResponse" }, (response) => {
      resolve(response?.responses?.[0] || null);
    });
  });
}

async function checkLoginStatusAdvanced(successPatterns, failurePattern) {
  const currentUrl = window.location.href;
  const responseInfo = await getLastResponseInfo();
  
  let success = false;
  let reason = "";
  
  // Check for Instagram-specific success indicators
  const isInstagramSuccess = (
    currentUrl.includes('/direct/inbox/') ||
    currentUrl.includes('/accounts/edit/') ||
    currentUrl.includes('/accounts/activity/') ||
    currentUrl.includes('instagram.com/?hl=en') && !currentUrl.includes('?flo=true') ||
    document.querySelector('nav') || // Navbar appears after login
    document.querySelector('svg[aria-label="Home"]') || // Home icon
    document.querySelector('div[role="tablist"]') // Instagram main feed tabs
  );
  
  if (isInstagramSuccess) {
    success = true;
    reason = "Instagram login success detected (main feed/navbar present)";
  }
  
  // Check success URL pattern
  if (!success && successPatterns.urlContains && successPatterns.urlContains.trim() !== "") {
    if (currentUrl.includes(successPatterns.urlContains) && !currentUrl.includes('?flo=true')) {
      success = true;
      reason = `URL contains "${successPatterns.urlContains}"`;
    }
  }
  
  // Check success element
  if (!success && successPatterns.elementExists && successPatterns.elementExists.trim() !== "") {
    const el = document.querySelector(successPatterns.elementExists);
    if (el && el.offsetParent !== null) {
      success = true;
      reason = `Element "${successPatterns.elementExists}" found`;
    }
  }
  
  // Check HTTP response
  if (responseInfo) {
    const status = responseInfo.statusCode;
    const location = responseInfo.location;
    
    if (location && (location.includes('/direct/') || location.includes('/accounts/'))) {
      success = true;
      reason = `Redirect to success page: ${location}`;
    }
    
    if (!success && (status === 401 || status === 403)) {
      reason = `HTTP ${status} - Unauthorized`;
    }
  }
  
  // Check for failure indicators
  if (!success && failurePattern && failurePattern.trim() !== "") {
    const failEl = document.querySelector(failurePattern);
    if (failEl && failEl.offsetParent !== null) {
      reason = `Failure element "${failurePattern}" detected`;
    }
  }
  
  // Instagram specific failure detection
  if (currentUrl.includes('?flo=true') || document.querySelector('._ab2z') || document.querySelector('div[role="alert"]')) {
    if (!success) reason = "Instagram login failed (incorrect credentials)";
  }
  
  return {
    success,
    reason: reason || (responseInfo ? `HTTP ${responseInfo.statusCode} | URL: ${currentUrl}` : `No success pattern matched | URL: ${currentUrl}`),
    currentUrl,
    httpStatus: responseInfo?.statusCode,
    redirectLocation: responseInfo?.location
  };
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "detectForms") {
    sendResponse({ forms: detectLoginForms() });
  }
  else if (request.action === "attemptLogin") {
    (async () => {
      try {
        await fillAndSubmitAdvanced(request.username, request.password, request.selectors);
        await delay(4000); // Wait longer for Instagram
        const status = await checkLoginStatusAdvanced(request.successPatterns, request.failurePattern);
        sendResponse({ 
          success: status.success, 
          message: status.reason,
          currentUrl: status.currentUrl,
          httpStatus: status.httpStatus,
          redirect: status.redirectLocation
        });
      } catch (err) {
        sendResponse({ success: false, message: err.message, currentUrl: window.location.href });
      }
    })();
    return true;
  }
});