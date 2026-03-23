// =============================================================================
// FILE: background.js (Chrome Extension - Service Worker, Manifest V3)
// DESCRIPTION: ตรวจสอบสถานะ Tomcat ทุก 5 นาที ผ่าน chrome.alarms
//              แล้ว POST ผลลัพธ์ไปยัง GAS Webhook พร้อมรับข้อมูลจาก Grafana
// =============================================================================

// ---------------------------------------------------------------------------
// CONFIG - แก้ไขค่าเหล่านี้ก่อนติดตั้ง
// ---------------------------------------------------------------------------
const CONFIG = {
  TOMCAT_URL: 'http://192.168.13.13:8080/',
  GAS_WEBHOOK: 'https://script.google.com/a/macros/mono.co.th/s/AKfycbwERYkvdSQ7QreHibIcqyvV8QHsHD-mWro4SuQ3ytAW4HizOYq52CVCcRLGL_twb0Jd/exec',
  ALARM_NAME: 'tomcat-check',
  TIMEOUT_MS: 10_000, // หยุดรอ Response ที่ 10 วินาที
};

// Default interval หากยังไม่มีการตั้งค่าจาก SYS_Monitor_Settings
const DEFAULT_INTERVAL_MIN = 5;

chrome.runtime.onInstalled.addListener(() => {
  _scheduleAlarm();
  _checkTomcat(); // Initial check
  console.log('[TomcatMonitor] Extension installed. Alarm scheduled & Initial check triggered.');
});

chrome.runtime.onStartup.addListener(() => {
  _scheduleAlarm();
  _checkTomcat(); // Initial check
});

/**
 * Update Extension Badge for visual feedback
 */
function _updateBadge(status) {
  const { isOnline, text, color } = status;
  chrome.action.setBadgeText({ text: text || (isOnline ? 'ON' : 'ERR') });
  chrome.action.setBadgeBackgroundColor({ color: color || (isOnline ? '#4CAF50' : '#F44336') });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CONFIG.ALARM_NAME) {
    _checkTomcat();
  }
});

// ---------------------------------------------------------------------------
// onMessage : รับส่งข้อมูลระหว่าง Content Script และ Popup
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // 1. รับคำขอจาก popup.js (เมื่อผู้ใช้คลิกไอคอน Extension)
  if (message.action === "getLatestData") {
    chrome.storage.local.get(['latestGrafanaData', 'lastTomcatCheck', 'nextCheckTime'], (result) => {
      sendResponse({
        data: result.latestGrafanaData || null,
        tomcat: result.lastTomcatCheck || null,
        nextCheckTime: result.nextCheckTime || null
      });
    });
    return true; // สำคัญ: บอก Chrome ว่าจะส่ง Response แบบ Async
  }

  // 2. รับข้อมูลจาก content.js (Grafana Scraper)
  // message จะอยู่ในรูปแบบ { metrics: payload } โดย payload คือ { timestamp, metrics, alerts, hasAlert }
  if (message.metrics) {
    console.log("[Background] Received Grafana Data:", message);

    const payload = message.metrics; // ดึง payload จริงๆ ออกมา

    // บันทึกลง Storage เพื่อให้ Popup ดึงไปแสดงผลได้
    chrome.storage.local.set({ latestGrafanaData: payload });

    // ส่งต่อไปที่ GAS Webhook
    _processGrafanaData(payload);

    sendResponse({ status: "success", received: true });
    return false;
  }
});

// ---------------------------------------------------------------------------
// ฟังก์ชันจัดการข้อมูล Grafana ส่งไป GAS
// ---------------------------------------------------------------------------
async function _processGrafanaData(data) {
  const payload = {
    action: 'log_grafana',
    data: data
  };

  try {
    const res = await fetch(CONFIG.GAS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.config) _syncConfig(json.config);
    console.log("[Background] Grafana data sent to GAS successfully.");
    
    // Briefly pulse badge or show text to indicate Grafana activity
    chrome.action.setBadgeText({ text: 'SCRP' });
    chrome.action.setBadgeBackgroundColor({ color: '#2196F3' }); // Blue for Scrape
    setTimeout(() => {
        // Revert to Tomcat status after 2 seconds
        chrome.storage.local.get(['lastTomcatCheck'], (res) => {
            if (res.lastTomcatCheck) {
                _updateBadge(res.lastTomcatCheck);
            }
        });
    }, 2000);
  } catch (err) {
    console.error("[Background] Failed to send Grafana data to GAS:", err.message);
  }
}

/**
 * ซิงค์การตั้งค่าจาก GAS (เช่น Interval, Thresholds)
 * อัปเดตทั้ง Tomcat และ Grafana interval
 */
function _syncConfig(config) {
  if (!config.intervalMin && !config.grafanaIntervalSec && !config.thresholds) return;

  const updates = {};
  if (config.intervalMin) updates.intervalMin = config.intervalMin;
  if (config.grafanaIntervalSec) updates.grafanaIntervalSec = config.grafanaIntervalSec;
  if (config.thresholds) updates.thresholds = config.thresholds;

  chrome.storage.local.set(updates, () => {
    if (config.intervalMin) {
      console.log(`[Monitor] Updating Tomcat interval to ${config.intervalMin} min`);
      _scheduleAlarm();
    }
    if (config.grafanaIntervalSec || config.thresholds) {
      console.log(`[Monitor] Updating Grafana config`, { interval: config.grafanaIntervalSec, thresholds: config.thresholds });
      // Broadcast to content scripts
      chrome.tabs.query({ url: ['https://*.mono.co.th/*', 'https://grafana-max.mthcdn.com/*'] }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { 
            action: 'updateConfig', 
            intervalSec: config.grafanaIntervalSec,
            thresholds: {
              maxDur: config.thresholds.maxDur,
              maxDurELB: config.thresholds.maxDurELB,
              maxErr: config.thresholds.maxErr
            }
          }).catch(() => {});
        });
      });
    }
  });
}

// ---------------------------------------------------------------------------
// _scheduleAlarm : สร้าง/รีเซ็ต Alarm (ใช้ค่าจาก SYS_Monitor_Settings ผ่าน storage)
// ---------------------------------------------------------------------------
function _scheduleAlarm() {
  chrome.storage.local.get(['intervalMin'], (res) => {
    const interval = parseInt(res.intervalMin || DEFAULT_INTERVAL_MIN);
    chrome.alarms.clear(CONFIG.ALARM_NAME, () => {
      chrome.alarms.create(CONFIG.ALARM_NAME, {
        delayInMinutes: interval,
        periodInMinutes: interval,
      });
      // คำนวณและบันทึกเวลาเช็คครั้งถัดไป
      const nextCheckTime = Date.now() + (interval * 60 * 1000);
      chrome.storage.local.set({ nextCheckTime });
      console.log(`[Monitor] Alarm scheduled every ${interval} minutes (from SYS_Monitor_Settings). Next check: ${new Date(nextCheckTime).toLocaleTimeString()}`);
    });
  });
}

// ---------------------------------------------------------------------------
// _checkTomcatOnce : ตรวจสอบ Tomcat ครั้งเดียว (Helper function)
// ---------------------------------------------------------------------------
async function _checkTomcatOnce() {
  const startTime = Date.now();
  let statusCode = null;
  let responseTime = null;
  let isOnline = false;
  let error = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

    const response = await fetch(CONFIG.TOMCAT_URL, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    responseTime = Date.now() - startTime;
    statusCode = response.status;
    isOnline = response.status >= 200 && response.status < 400;

  } catch (err) {
    responseTime = Date.now() - startTime;
    isOnline = false;
    statusCode = 0;
    error = err.message;
  }

  return { isOnline, statusCode, responseTime, error };
}

// ---------------------------------------------------------------------------
// _checkTomcat : ส่ง Request ไปยัง Tomcat พร้อม Double Check กรณี Timeout
// ---------------------------------------------------------------------------
async function _checkTomcat() {

  // === เพิ่มการเช็คสถานะจากผู้ใช้ ===
  const storage = await chrome.storage.local.get(['tomcatEnabled']);
  if (storage.tomcatEnabled === false) {
    console.log("[TomcatMonitor] การเช็ค Tomcat ถูกปิดไว้โดยผู้ใช้งาน (Disabled). ข้ามรอบนี้.");
    return; // หยุดการทำงานของรอบนี้ทันที (ไม่ยิง API ไม่ส่งเข้า GAS)
  }
  // ============================

  // === Check ครั้งที่ 1 ===
  let result = await _checkTomcatOnce();
  console.log(`[TomcatMonitor] Check #1: isOnline=${result.isOnline} | status=${result.statusCode} | rt=${result.responseTime}ms`);

  // === Double Check กรณีล้มเหลวครั้งแรก ===
  if (!result.isOnline) {
    console.log('[TomcatMonitor] First check failed, waiting 3 seconds for double check...');
    await new Promise(resolve => setTimeout(resolve, 3000)); // รอ 3 วินาที
    
    const secondResult = await _checkTomcatOnce();
    console.log(`[TomcatMonitor] Check #2 (Double Check): isOnline=${secondResult.isOnline} | status=${secondResult.statusCode} | rt=${secondResult.responseTime}ms`);
    
    // ถ้า check ครั้งที่ 2 สำเร็จ ใช้ค่าครั้งที่ 2 แทน (อาจเป็น false positive)
    if (secondResult.isOnline) {
      console.log('[TomcatMonitor] Double check passed! Likely false positive, using second check result.');
      result = secondResult;
    } else {
      console.log('[TomcatMonitor] Double check also failed. Confirming Tomcat is OFFLINE.');
      // เก็บข้อมูลว่าเป็น consecutive failure
      const { consecutiveFailures = 0 } = await chrome.storage.local.get(['consecutiveFailures']);
      await chrome.storage.local.set({ consecutiveFailures: consecutiveFailures + 1 });
    }
  } else {
    // รีเซ็ต consecutive failures เมื่อสำเร็จ
    await chrome.storage.local.set({ consecutiveFailures: 0 });
  }

  // Update Badge (Max 4 chars)
  const badgeText = result.isOnline 
    ? (result.responseTime < 1000 ? String(result.responseTime) : (result.responseTime/1000).toFixed(1) + 's') 
    : 'ERR';
  _updateBadge({ isOnline: result.isOnline, text: badgeText });
  
  await _postToGAS({ 
    statusCode: result.statusCode, 
    responseTime: result.responseTime, 
    isOnline: result.isOnline 
  });
}

// ---------------------------------------------------------------------------
// _postToGAS : ส่ง Payload ไปยัง GAS Webhook (Tomcat)
// ---------------------------------------------------------------------------
async function _postToGAS({ statusCode, responseTime, isOnline }) {
  const payload = {
    action: 'log_tomcat',
    statusCode,
    responseTime,
    isOnline,
  };

  try {
    const res = await fetch(CONFIG.GAS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    console.log('[TomcatMonitor] GAS response:', json);
    if (json.config) _syncConfig(json.config);

    // บันทึกสถิติ Tomcat ล่าสุดลง Storage (เผื่อให้ Popup ดึงไปโชว์)
    chrome.storage.local.set({
      lastTomcatCheck: {
        timestamp: new Date().toISOString(),
        isOnline,
        statusCode,
        responseTime,
      }
    });

  } catch (err) {
    console.error('[TomcatMonitor] Failed to POST to GAS:', err.message);
  }
}