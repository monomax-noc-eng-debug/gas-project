(function () {
  let SCRAPE_INTERVAL = 3000; // ค่าเริ่มต้น (ms) จะถูกอัปเดตจาก background
  let THRESHOLDS = { maxDur: 0.5, maxDurELB: 0.5, maxErr: 5.0 }; // ค่าเริ่มต้น จะถูกอัปเดตจาก background
  let intervalId = null;

  // รับค่า config จาก background แบบ real-time
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateConfig') {
      if (message.intervalSec) {
        const newInterval = message.intervalSec * 1000;
        console.log(`[GrafanaScraper] Updating interval from ${SCRAPE_INTERVAL}ms to ${newInterval}ms`);
        SCRAPE_INTERVAL = newInterval;
        // Restart interval with new value
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = setInterval(scrapeData, SCRAPE_INTERVAL);
        }
      }
      if (message.thresholds) {
        console.log(`[GrafanaScraper] Updating thresholds`, message.thresholds);
        THRESHOLDS = { ...THRESHOLDS, ...message.thresholds };
      }
    }
    return false;
  });

  // ขอค่า config ล่าสุดจาก background เมื่อเริ่มต้น
  chrome.storage.local.get(['grafanaIntervalSec', 'thresholds'], (res) => {
    if (res.grafanaIntervalSec) {
      SCRAPE_INTERVAL = res.grafanaIntervalSec * 1000;
      console.log(`[GrafanaScraper] Loaded interval from storage: ${SCRAPE_INTERVAL}ms`);
    }
    if (res.thresholds) {
      THRESHOLDS = { ...THRESHOLDS, ...res.thresholds };
      console.log(`[GrafanaScraper] Loaded thresholds from storage`, THRESHOLDS);
    }
    // เริ่มกระบวนการกวาดข้อมูล
    intervalId = setInterval(scrapeData, SCRAPE_INTERVAL);
    scrapeData();
  });

  // ฟังก์ชันนี้เช็คการเชื่อมต่อของ Extension แบบเงียบๆ ไม่ต้องโวยวาย
  function isContextAlive() {
    return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
  }

  function sendToBackground(payload) {
    if (!isContextAlive()) {
      if (intervalId) clearInterval(intervalId);
      return;
    }
    try {
      chrome.runtime.sendMessage({ metrics: payload }, () => {
        if (chrome.runtime.lastError) {
          if (intervalId) clearInterval(intervalId);
        }
      });
    } catch (e) {
      if (intervalId) clearInterval(intervalId);
    }
  }

  function expandAllPanels() {
    const btns = document.querySelectorAll('button[aria-label="Expand row"], .dashboard-row--collapsed');
    if (btns.length === 0) return false;
    btns.forEach(btn => btn.click());
    return true; 
  }

  function getHTTPStatus() {
    const result = { monomax_me: null, www_monomax_me: null };
    const elements = document.querySelectorAll('td, .flot-temp-elem, [class*="value-text"], [class*="value-inner"]');
    elements.forEach(el => {
      const text = el.innerText.trim();
      if (/^\d{3}$/.test(text)) {
        const ctx = el.closest('tr')?.innerText.toLowerCase() || el.closest('[class*="panel-content"]')?.innerText.toLowerCase() || "";
        if (ctx.includes('monomax.me')) {
          if (ctx.includes('www.monomax.me')) result.www_monomax_me = text;
          else result.monomax_me = text;
        }
      }
    });
    return result;
  }

  function getResponseDurations() {
    const result = { monomax_me: null, www_monomax_me: null, elb_listener_https: null };
    document.querySelectorAll('tr').forEach(row => {
      const text = row.innerText.toLowerCase();
      const cells = row.querySelectorAll('td');
      if (cells.length > 0) {
        // Check for monomax.me durations (last cell, plain number in seconds)
        const val = cells[cells.length - 1].innerText.trim();
        if (text.includes('monomax.me') && text.includes('.')) {
          if (/^-?[\d.]+(?!\d)$/.test(val)) {
            const valueInSeconds = parseFloat(val);
            if (text.includes('www.monomax.me')) result.www_monomax_me = valueInSeconds;
            else result.monomax_me = valueInSeconds;
          }
        }
        // Check for ELB listener (value is in first <td> with css- class)
        if (text.includes('elb') && text.includes('listener-https')) {
          const firstStyledCell = row.querySelector('td[class^="css-"], td[class*=" css-"]');
          if (firstStyledCell) {
            const cellText = firstStyledCell.innerText.trim();
            // Extract number AND unit from "69 milliseconds" format
            const match = cellText.match(/([\d.]+)\s*(milliseconds?|ms|s|seconds?)/i);
            if (match) {
              const num = parseFloat(match[1]);
              const unit = match[2].toLowerCase();
              // Convert to seconds for consistent comparison
              let valueInSeconds;
              if (unit.startsWith('milli') || unit === 'ms') {
                valueInSeconds = num / 1000;
              } else {
                valueInSeconds = num; // seconds
              }
              result.elb_listener_https = valueInSeconds;
            }
          }
        }
      }
    });
    return result;
  }

  function getErrorRates() {
    const result = { "5xx_www_api": null, "5xx_vod": null, "4xx_vod": null };
    document.querySelectorAll('tr').forEach(row => {
      const text = row.innerText;
      const cells = row.querySelectorAll('td');
      if (cells.length > 0) {
        const val = cells[cells.length - 1].innerText.trim();
        if (text.includes('5xx : WWW-API')) result["5xx_www_api"] = val;
        else if (text.includes('5xx : VOD')) result["5xx_vod"] = val;
        else if (text.includes('4xx : VOD')) result["4xx_vod"] = val;
      }
    });
    return result;
  }

  function scrapeData() {
    if (!isContextAlive()) {
      if (intervalId) clearInterval(intervalId);
      return;
    }
    const justExpanded = expandAllPanels();
    if (justExpanded) {
      setTimeout(() => { if (isContextAlive()) doScrape(); }, 2000);
    } else {
      doScrape();
    }
  }

  function doScrape() {
    if (!isContextAlive()) return;
    
    const metrics = {
      http_status: getHTTPStatus(),
      response_durations: getResponseDurations(),
      error_rate: getErrorRates()
    };
    
    const results = { 
      timestamp: new Date().toISOString(), 
      metrics, 
      alerts: [], 
      hasAlert: false 
    };

    // --- Threshold Check Logic ---
    // ใช้ THRESHOLDS ที่ถูกอัปเดตจาก GAS (global variable)
    
    // Check Duration
    if (parseFloat(metrics.response_durations.monomax_me) > THRESHOLDS.maxDur) 
       results.alerts.push({ type: 'danger', message: `monomax.me slow: ${metrics.response_durations.monomax_me}s` });
    if (parseFloat(metrics.response_durations.www_monomax_me) > THRESHOLDS.maxDur) 
       results.alerts.push({ type: 'danger', message: `www.monomax.me slow: ${metrics.response_durations.www_monomax_me}s` });
    if (parseFloat(metrics.response_durations.elb_listener_https) > (THRESHOLDS.maxDurELB || THRESHOLDS.maxDur))
       results.alerts.push({ type: 'danger', message: `ELB slow: ${metrics.response_durations.elb_listener_https}s` });
    
    // Check Status
    if (metrics.http_status.monomax_me && metrics.http_status.monomax_me != '200') 
       results.alerts.push({ type: 'danger', message: `monomax.me status: ${metrics.http_status.monomax_me}` });
    if (metrics.http_status.www_monomax_me && metrics.http_status.www_monomax_me != '200') 
       results.alerts.push({ type: 'danger', message: `www.monomax.me status: ${metrics.http_status.www_monomax_me}` });

    // Check Error Rate (remove % before check)
    const checkErr = (val) => val ? parseFloat(val.replace('%','')) : 0;
    if (checkErr(metrics.error_rate['5xx_www_api']) > THRESHOLDS.maxErr)
       results.alerts.push({ type: 'danger', message: `WWW-API 5xx: ${metrics.error_rate['5xx_www_api']}` });
    if (checkErr(metrics.error_rate['5xx_vod']) > THRESHOLDS.maxErr)
       results.alerts.push({ type: 'danger', message: `VOD 5xx: ${metrics.error_rate['5xx_vod']}` });

    results.hasAlert = results.alerts.length > 0;

    // ต้องส่ง results ตรงๆ (ไม่ต้องห่อ metrics) เพราะ sendToBackground จะห่อให้อีกชั้น
    sendToBackground(results);
  }

})();