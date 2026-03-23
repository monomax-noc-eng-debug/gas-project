// =============================================================================
// FILE: GAS_Monitor_Tomcat.js
// DESCRIPTION: Backend สำหรับรับข้อมูลจาก Chrome Extension และส่งข้อมูลให้ Dashboard
// =============================================================================

const TOMCAT_SHEET_NAME = 'DB_Tomcat';
const GRAFANA_SHEET_NAME = 'DB_Grafana';
const LOG_MAX_ROWS      = 100; // เก็บสูงสุด 100 รายการล่าสุด

/**
 * doPost : รับ Payload จาก Chrome Extension แล้วบันทึกลง Sheet
 * Payload (JSON): { action, statusCode, responseTime, isOnline }
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const ss      = SpreadsheetApp.openById(CONFIG.DB_ID);
    const now     = new Date();

    // --- CASE 1: LOG TOMCAT ---
    if (payload.action === 'log_tomcat') {
      let sheet = ss.getSheetByName(TOMCAT_SHEET_NAME);
      if (!sheet) {
        sheet = ss.insertSheet(TOMCAT_SHEET_NAME);
        sheet.appendRow(['Timestamp', 'StatusCode', 'ResponseTime_ms', 'IsOnline']);
        sheet.setFrozenRows(1);
      }
      sheet.appendRow([
        now,
        payload.statusCode   ?? '',
        payload.responseTime ?? '',
        payload.isOnline     ? 'TRUE' : 'FALSE'
      ]);
      _trimSheet(sheet, LOG_MAX_ROWS);

      // Tomcat Alert Logic
      const props = PropertiesService.getScriptProperties();
      const lastStatus = props.getProperty('TOMCAT_LAST_STATUS');
      const currentStatusStr = payload.isOnline ? 'ONLINE' : 'OFFLINE';
      
      if (currentStatusStr !== lastStatus) {
        sendTomcatChatAlert(payload.isOnline, payload.responseTime);
        props.setProperty('TOMCAT_LAST_STATUS', currentStatusStr);
      }
      return _jsonResponse({ success: true, message: 'Tomcat logged' });
    }

    // --- CASE 2: LOG GRAFANA ---
    if (payload.action === 'log_grafana') {
      let sheet = ss.getSheetByName(GRAFANA_SHEET_NAME);
      if (!sheet) {
        sheet = ss.insertSheet(GRAFANA_SHEET_NAME);
        sheet.appendRow(['Timestamp', 'Mono_Status', 'WWW_Status', 'Mono_Dur', 'WWW_Dur', 'WWW_Err', 'VOD_5xx_Err', 'VOD_4xx_Err', 'ELB_Dur']);
        sheet.setFrozenRows(1);
      }

      const m = payload.data.metrics;
      sheet.appendRow([
        now,
        m.http_status.monomax_me,
        m.http_status.www_monomax_me,
        m.response_durations.monomax_me,
        m.response_durations.www_monomax_me,
        m.error_rate['5xx_www_api'],
        m.error_rate['5xx_vod'],
        m.error_rate['4xx_vod'],
        m.response_durations.elb_listener_https
      ]);
      _trimSheet(sheet, LOG_MAX_ROWS);

      // Check Thresholds & Alert
      _checkGrafanaThresholds(payload.data);

      const monSet = _getMonitorSettings();
      return _jsonResponse({ 
        success: true, 
        message: 'Grafana logged',
        config: { 
          intervalMin: parseInt(monSet.MON_CHECK_INTERVAL_MIN || 5),
          grafanaIntervalSec: parseInt(monSet.MON_GRAFANA_INTERVAL_SEC || 3),
          thresholds: {
            maxDur: parseFloat(monSet.MON_THRESHOLD_ELB_SEC || 0.5),
            maxErr: parseFloat(monSet.MON_THRESHOLD_WWW_5XX_PCT || 5.0)
          }
        }
      });
    }

    // --- CASE 3: LOG TOMCAT ---
    if (payload.action === 'log_tomcat') {
       _logTomcatData(payload, ss);
       
       const monSet = _getMonitorSettings();
       return _jsonResponse({ 
         success: true, 
         message: 'Tomcat logged',
         config: { intervalMin: parseInt(monSet.MON_CHECK_INTERVAL_MIN || 5) }
       });
    }

    return _jsonResponse({ success: false, message: 'Unknown action' });

  } catch (err) {
    return _jsonResponse({ success: false, message: err.message });
  }
}

/**
 * แยก Logic การบันทึก Tomcat
 */
function _logTomcatData(p, ss) {
  let sheet = ss.getSheetByName(TOMCAT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TOMCAT_SHEET_NAME);
    sheet.appendRow(['Timestamp', 'StatusCode', 'ResponseTime', 'IsOnline']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), p.statusCode, p.responseTime, p.isOnline]);
  _trimSheet(sheet, LOG_MAX_ROWS);

  // แจ้งเตือนถ้า Offline (ใช้ throttle แยกสำหรับ Tomcat)
  if (!p.isOnline) {
    _sendTomcatAlertWithThrottle([`Tomcat is OFFLINE! Status: ${p.statusCode}`]);
  }
}

/**
 * จัดการการส่งแจ้งเตือนพร้อมตรวจสอบบัฟเฟอร์เวลา (Throttle)
 */
function _sendAlertWithThrottle(alerts) {
  if (!alerts || alerts.length === 0) return;

  const props = PropertiesService.getScriptProperties();
  const settings = _getMonitorSettings();
  const throttleMin = parseInt(settings.MON_ALERT_THROTTLE_MIN || 15);
  const lastAlertTime = parseInt(props.getProperty("LAST_MON_ALERT_TIME") || 0);
  const now = Date.now();

  // ตรวจสอบว่าพ้นช่วงพักการแจ้งเตือนหรือยัง (ยกเว้นกรณี Critical หรือต้องการให้ส่งทุกครั้ง)
  if (now - lastAlertTime < throttleMin * 60 * 1000) {
    console.log("Alert throttled. Skipping...");
    return;
  }

  const webhookUrl = CONFIG.WEBHOOKS?.group_all || props.getProperty("CHAT_WEBHOOK_MAIN");
  if (webhookUrl) {
    sendGrafanaChatAlert(alerts, webhookUrl);
    props.setProperty("LAST_MON_ALERT_TIME", now.toString());
  }
}

/**
 * จัดการการส่งแจ้งเตือน Tomcat พร้อมตรวจสอบบัฟเฟอร์เวลา (Throttle)
 * ใช้ค่า MON_TOMCAT_ALERT_THROTTLE_MIN แยกจาก Grafana
 */
function _sendTomcatAlertWithThrottle(alerts) {
  if (!alerts || alerts.length === 0) return;

  const props = PropertiesService.getScriptProperties();
  const settings = _getMonitorSettings();
  const throttleMin = parseInt(settings.MON_TOMCAT_ALERT_THROTTLE_MIN || 60); // ค่าเริ่มต้น 60 นาที
  const lastAlertTime = parseInt(props.getProperty("LAST_TOMCAT_ALERT_TIME") || 0);
  const now = Date.now();

  // ตรวจสอบว่าพ้นช่วงพักการแจ้งเตือนหรือยัง
  if (now - lastAlertTime < throttleMin * 60 * 1000) {
    console.log("Tomcat alert throttled. Skipping...");
    return;
  }

  const webhookUrl = CONFIG.WEBHOOKS?.group_all || props.getProperty("CHAT_WEBHOOK_MAIN");
  if (webhookUrl) {
    sendGrafanaChatAlert(alerts, webhookUrl);
    props.setProperty("LAST_TOMCAT_ALERT_TIME", now.toString());
  }
}

/**
 * ลบแถวเก่าที่เกินกำหนด
 */
function _trimSheet(sheet, max) {
  const dataRows = sheet.getLastRow() - 1;
  if (dataRows > max) {
    const excess = dataRows - max;
    sheet.deleteRows(2, excess);
  }
}

/**
 * ตรวจสอบค่า Metrics เทียบกับ Settings
 */
function _checkGrafanaThresholds(data) {
  const settings = _getMonitorSettings();
  const m = data.metrics;
  const alerts = [];

  const checkVal = (v, thresholdKey) => {
    const val = parseFloat(String(v || "").replace('%',''));
    const limit = parseFloat(settings[thresholdKey] || 999);
    return val > limit;
  };

  if (checkVal(m.response_durations.monomax_me, 'MON_THRESHOLD_ELB_SEC')) alerts.push(`monomax.me slow: ${m.response_durations.monomax_me}s`);
  if (checkVal(m.response_durations.www_monomax_me, 'MON_THRESHOLD_ELB_SEC')) alerts.push(`www.monomax.me slow: ${m.response_durations.www_monomax_me}s`);
  if (checkVal(m.response_durations.elb_listener_https, 'MON_THRESHOLD_ELB_LISTENER_SEC')) alerts.push(`ELB Listener slow: ${m.response_durations.elb_listener_https}s`);
  
  if (checkVal(m.error_rate['5xx_www_api'], 'MON_THRESHOLD_WWW_5XX_PCT')) alerts.push(`WWW-API 5xx high: ${m.error_rate['5xx_www_api']}%`);
  if (checkVal(m.error_rate['5xx_vod'], 'MON_THRESHOLD_VOD_5XX_PCT')) alerts.push(`VOD 5xx high: ${m.error_rate['5xx_vod']}%`);
  if (checkVal(m.error_rate['4xx_vod'], 'MON_THRESHOLD_VOD_4XX_PCT')) alerts.push(`VOD 4xx high: ${m.error_rate['4xx_vod']}%`);
  
  if (m.http_status.monomax_me && m.http_status.monomax_me != '200') alerts.push(`monomax.me down: ${m.http_status.monomax_me}`);
  if (m.http_status.www_monomax_me && m.http_status.www_monomax_me != '200') alerts.push(`www.monomax.me down: ${m.http_status.www_monomax_me}`);

  if (alerts.length > 0) {
    _sendAlertWithThrottle(alerts);
  }
}

/**
 * ดึงค่าตั้งค่าจาก Sheet
 */
function _getMonitorSettings() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
    const sheet = ss.getSheetByName("SYS_Monitor_Settings");
    if (!sheet) return {};
    const data = sheet.getDataRange().getValues();
    const obj = {};
    data.slice(1).forEach(r => {
      if (r[0]) obj[r[0]] = r[1];
    });
    return obj;
  } catch(e) {
    return {
      "MON_CHECK_INTERVAL_MIN": 5,
      "MON_GRAFANA_INTERVAL_SEC": 3,
      "MON_ALERT_THROTTLE_MIN": 15,
      "MON_TOMCAT_ALERT_THROTTLE_MIN": 60,
      "MON_THRESHOLD_ELB_SEC": 0.5,
      "MON_THRESHOLD_ELB_LISTENER_SEC": 0.5,
      "MON_THRESHOLD_WWW_5XX_PCT": 5.0,
      "MON_THRESHOLD_VOD_5XX_PCT": 5.0,
      "MON_THRESHOLD_VOD_4XX_PCT": 5.0
    };
  }
}

/**
 * getGrafanaChartData : ดึงข้อมูล Grafana 60 รายการล่าสุด
 */
function getGrafanaChartData() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
    const sheet = ss.getSheetByName(GRAFANA_SHEET_NAME);
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, labels: [], durMono: [], durWWW: [], durELB: [], errWWW: [], errVOD: [], errVOD4xx: [] };

    const lastRow = sheet.getLastRow();
    const startRow = Math.max(2, lastRow - 59);
    const numRows = lastRow - startRow + 1;
    const values = sheet.getRange(startRow, 1, numRows, 9).getValues(); // 9 columns

    const labels = [];
    const durMono = [];
    const durWWW = [];
    const durELB = [];
    const errWWW = [];
    const errVOD = [];
    const errVOD4xx = [];

    values.forEach(r => {
      labels.push(Utilities.formatDate(new Date(r[0]), "Asia/Bangkok", "HH:mm"));
      durMono.push(parseFloat(r[3]) || 0);
      durWWW.push(parseFloat(r[4]) || 0);
      errWWW.push(parseFloat(r[5]) || 0);
      errVOD.push(parseFloat(r[6]) || 0);
      errVOD4xx.push(parseFloat(r[7]) || 0);
      durELB.push(parseFloat(r[8]) || 0);
    });

    return { success: true, labels, durMono, durWWW, durELB, errWWW, errVOD, errVOD4xx };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * getTomcatLogs : อ่านข้อมูล Tomcat สำหรับ Dashboard
 * ส่งค่า status เป็น 1 (online) หรือ 0 (offline) แทน true/false เพื่อง่ายต่อการทำกราฟ
 */
function getTomcatLogs() {
  try {
    const ss    = SpreadsheetApp.openById(CONFIG.DB_ID);
    const sheet = ss.getSheetByName(TOMCAT_SHEET_NAME);

    if (!sheet || sheet.getLastRow() <= 1) {
      return { success: true, data: [] };
    }

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    
    // คำนวณ uptime percentage จากข้อมูลทั้งหมด
    const totalRows = rows.length;
    const onlineRows = rows.filter(row => row[3] === true || row[3] === 'TRUE' || row[3] === 'true' || row[3] === 1).length;
    const uptimePct = totalRows > 0 ? ((onlineRows / totalRows) * 100).toFixed(2) : 0;

    const data = rows.map(row => {
      const isOnline = row[3] === true || row[3] === 'TRUE' || row[3] === 'true' || row[3] === 1;
      return {
        timestamp    : row[0] ? new Date(row[0]).toISOString() : '',
        statusCode   : row[1],
        responseTime : row[2],
        isOnline     : isOnline,        // เก็บ boolean ไว้ใช้งานทั่วไป
        status       : isOnline ? 1 : 0, // สำหรับทำกราฟ (1 = online, 0 = offline)
        value        : isOnline ? (row[2] || 0) : 0 // ค่าสำหรับพล็อตกราฟ (response time หรือ 0)
      };
    });

    return { success: true, data, uptime: uptimePct };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * ส่งแจ้งเตือน Tomcat เข้า Google Chat
 */
function sendTomcatChatAlert(isOnline, responseTime) {
  const props = PropertiesService.getScriptProperties();
  const webhookUrl = props.getProperty("CHAT_WEBHOOK_MAIN");
  if (!webhookUrl) return;

  const titleColor = isOnline ? "#10b981" : "#f43f5e";
  const statusLabel = isOnline ? "Online (ปกติ)" : "Offline (ระบบขัดข้อง)";
  const msgDetail = isOnline 
    ? `Response Time: ${responseTime ? responseTime + ' ms' : 'N/A'}`
    : "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ หรือ Timeout (เกิน 10 วินาที)";

  const payload = {
    "cardsV2": [{
      "cardId": "tomcatAlertCard",
      "card": {
        "header": { "title": "Apache Tomcat Status", "subtitle": "NOC Monitoring System" },
        "sections": [{
          "widgets": [
            { "decoratedText": { "topLabel": "System / Server", "text": `<b>Apache Tomcat (192.168.13.13:8080)</b>` } },
            { "decoratedText": { "topLabel": "Current Status", "text": `<font color="${titleColor}"><b>${statusLabel}</b></font>` } },
            { "decoratedText": { "topLabel": "Details", "text": msgDetail, "wrapText": true } }
          ]
        }]
      }
    }]
  };

  UrlFetchApp.fetch(webhookUrl, {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  });
}

/**
 * ส่งแจ้งเตือน Grafana เข้า Google Chat (สีเหลืองสำหรับ Threshold Alert)
 */
function sendGrafanaChatAlert(alerts, webhookUrl) {
  if (!webhookUrl) return;

  const payload = {
    "cardsV2": [{
      "cardId": "grafanaAlertCard",
      "card": {
        "header": { 
          "title": "⚠️ Grafana Threshold Alert", 
          "subtitle": "Performance Threshold Exceeded",
          "imageType": "AVATAR",
          "imageUrl": "https://www.gstatic.com/images/icons/material/system/1x/warning_amber_48dp.png"
        },
        "style": {
          "backgroundColor": {
            "red": 1.0,
            "green": 0.95,
            "blue": 0.85
          }
        },
        "sections": [{
          "widgets": [
            { "decoratedText": { "topLabel": "Alert Details", "text": alerts.join('<br>'), "wrapText": true } }
          ]
        }]
      }
    }]
  };

  UrlFetchApp.fetch(webhookUrl, {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  });
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
