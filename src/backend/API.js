
// =================================================================
// 🔧 UTILITIES
// =================================================================
const API_UTILS = (() => {
  const getDbId = () => (typeof CONFIG !== 'undefined' ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty('CORE_SHEET_ID'));

  return {
    getDbSheet: function () {
      const dbId = getDbId();
      if (!dbId) throw new Error("DB_ID is missing.");
      return SpreadsheetApp.openById(dbId).getSheetByName("DB_Matches");
    },
    createRes: function (s, d) { return JSON.stringify(s ? { success: true, data: d } : { success: false, message: d }); },
    getHeaderMap: function (sheet) {
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      return headers.reduce((acc, colName, idx) => {
        acc[colName.toLowerCase().trim()] = idx;
        return acc;
      }, { _headers: headers });
    },

    // ✅ Custom Date Parsing (รองรับ dd/MM/yyyy HH:mm:ss)
    parseCustomDateTime: function (val) {
      if (!val) return { date: null, time: null, obj: null };
      const strVal = String(val).trim();
      if (strVal === "" || strVal === "-") return { date: null, time: null, obj: null };

      let dObj = null;

      // Try 1: dd/MM/yyyy (Format ไทย/UK) -> 10/02/2026
      const dmy = strVal.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
      if (dmy) {
        const day = dmy[1].padStart(2, '0');
        const month = dmy[2].padStart(2, '0');
        const year = dmy[3];
        const hour = (dmy[4] || "00").padStart(2, '0');
        const min = (dmy[5] || "00").padStart(2, '0');
        dObj = new Date(`${year}-${month}-${day}T${hour}:${min}:00`);
      }
      // Try 2: yyyy-MM-dd (Format ISO/Database) -> 2026-02-10
      else {
        const ymd = strVal.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
        if (ymd) {
          const year = ymd[1];
          const month = ymd[2].padStart(2, '0');
          const day = ymd[3].padStart(2, '0');
          const hour = (ymd[4] || "00").padStart(2, '0');
          const min = (ymd[5] || "00").padStart(2, '0');
          dObj = new Date(`${year}-${month}-${day}T${hour}:${min}:00`);
        }
        // Try 3: Date Object or Fallback
        else {
          dObj = new Date(val);
        }
      }

      if (dObj && !isNaN(dObj.getTime())) {
        const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
        return {
          date: Utilities.formatDate(dObj, tz, "yyyy-MM-dd"), // Return Standard format for comparison
          time: Utilities.formatDate(dObj, tz, "HH:mm"),
          obj: dObj
        };
      }
      return { date: null, time: null, obj: null };
    },

    formatDateTime: function (val, type) {
      const parsed = this.parseCustomDateTime(val);
      if (!parsed.obj) return "";
      return type === 'date' ? parsed.date : parsed.time;
    }
  };
})();

// =================================================================
// 🌐 ROUTER & DELEGATES
// =================================================================
function doGet(e) { return HtmlService.createTemplateFromFile('src/frontend/index').evaluate().setTitle("Shift Report").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); }
function include(filename) { return HtmlService.createHtmlOutputFromFile(filename).getContent(); }

function apiHandler(request) {
  const { func, data } = request;
  const apiMap = {
    'getTickets': () => TicketController.getTickets(false),
    'createTicket': (d) => TicketController.createTicket(d),
    'updateTicket': (d) => TicketController.updateTicket(d),
    'deleteTicket': (id) => TicketController.deleteTicket(id),
    'getTicketConfig': () => TicketController.getTicketConfig(),
    'apiGetWorkList': () => MatchController.apiGetWorkList(),
    'apiCreateWorkItem': (d) => MatchController.apiCreateWorkItem(d),
    'apiUpdateWorkItem': (d) => MatchController.apiUpdateWorkItem(d),
    'apiDeleteWorkItem': (d) => MatchController.apiDeleteWorkItem(d),
    'apiStopWorkItem': (d) => MatchController.apiStopWorkItem(d),
    'getCalendarEvents': (d) => MatchController.apiGetCalendarEvents(d),
    'getMatchesByDate': (d) => getMatchesByDate(d),
    'getVerificationReport': (d) => getVerificationReport(d),
    'getTicketDetails': (d) => getTicketDetails(d),
    'processShiftReport': (d) => processShiftReport(d),
    'getDailyProofImages': (d) => getDailyProofImages(d),
    'getMasterTeamList': () => getMasterTeamList()
  };
  if (apiMap[func]) { try { return apiMap[func](data); } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); } }
  return JSON.stringify({ success: false, error: "Function not found" });
}

// Global Delegates
function getTickets(f) { return TicketController.getTickets(f); }
function createTicket(d) { return TicketController.createTicket(d); }
function updateTicket(d) { return TicketController.updateTicket(d); }
function deleteTicket(id) { return TicketController.deleteTicket(id); }
function getTicketConfig() { return TicketController.getTicketConfig(); }
function apiGetWorkList() { return MatchController.apiGetWorkList(); }
function apiCreateWorkItem(d) { return MatchController.apiCreateWorkItem(d); }
function apiUpdateWorkItem(d) { return MatchController.apiUpdateWorkItem(d); }
function apiDeleteWorkItem(d) { return MatchController.apiDeleteWorkItem(d); }
function apiStopWorkItem(d) { return MatchController.apiStopWorkItem(d); }
function apiGetCalendarEvents(d) { return MatchController.apiGetCalendarEvents(d); }
function getMatches() { return MatchController.apiGetWorkList(); }
function getUserSettings() { return JSON.stringify({ theme: "light", profile: { email: Session.getActiveUser().getEmail(), role: "Admin" } }); }

// =================================================================
// 1. TICKET LOGIC (New/Active/Closed)
// =================================================================
function getTicketDetails(dateString) {
  try {
    const res = TicketController.getTickets(false);
    const resObj = JSON.parse(res);
    if (!resObj.success) return res;

    const tickets = resObj.data || [];
    const targetDate = String(dateString).trim(); // yyyy-MM-dd

    let stats = { total: 0, new: 0, open: 0, pending: 0, resolved: 0, closed: 0 };
    let list = [];

    tickets.forEach(t => {
      // t format: [No, Date(1), ID(2), Type, Status(4), ..., CreatedDate(15), ResolvedDate(16)]
      if (!t || !t[2]) return;

      const id = t[2];
      const status = String(t[4] || "").toUpperCase().trim();
      const detail = t[9] || t[8] || '-';

      // ✅ Parse Date
      const createdParsed = API_UTILS.parseCustomDateTime(t[15]);
      const incidentParsed = API_UTILS.parseCustomDateTime(t[1]);
      const resolvedParsed = API_UTILS.parseCustomDateTime(t[16]);

      // ✅ Date Fallback: Created > Incident
      const createdDateStr = createdParsed.date || incidentParsed.date;
      const resolvedDateStr = resolvedParsed.date;

      // ✅ Comparisons
      const isCreatedToday = (createdDateStr === targetDate);
      const isResolvedToday = (resolvedDateStr === targetDate);
      const isActive = ["OPEN", "PENDING", "WAIT", "HOLD", "IN PROGRESS"].some(s => status.includes(s));
      const isClosedStatus = ["RESOLVED", "SUCCEED", "DONE", "FIX", "CLOSED", "CLOSE"].some(s => status.includes(s));

      // --- 1. NEW LOGIC ---
      // ถ้าสร้างวันนี้ = New เสมอ (ไม่ว่าสถานะปัจจุบันจะเป็น Open, Pending หรือ Closed)
      if (isCreatedToday) {
        stats.new++;
      }

      // --- 2. SHOW LIST LOGIC ---
      // แสดงถ้า: (ยังไม่ปิดงาน) OR (สร้างวันนี้) OR (ปิดงานวันนี้)
      if (isActive || isCreatedToday || (isClosedStatus && isResolvedToday)) {

        // Count Current Status
        if (status.includes("PENDING") || status.includes("WAIT")) stats.pending++;
        else if (status.includes("OPEN")) stats.open++;
        else if (status.includes("RESOLVED") || status.includes("FIX")) stats.resolved++;
        else if (status.includes("CLOSE")) stats.closed++;

        // Add to list with debug info if needed
        list.push({
          id: id,
          status: t[4], // Display Status
          detail: detail,
          isNew: isCreatedToday,
          _debugDate: createdDateStr // แอบส่งไปดูว่าอ่านวันที่ถูกไหม
        });
      }
    });

    stats.total = list.length;
    const summaryText = `Total: ${stats.total}\nNew: ${stats.new}\nOpen: ${stats.open}\nPending: ${stats.pending}\nResolved: ${stats.resolved}\nClosed: ${stats.closed}\n\n` +
      list.map(t => `[${t.status}] ${t.id} - ${t.detail}`).join("\n");

    return JSON.stringify({ success: true, list, stats, text: summaryText });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
}

// =================================================================
// 2. MATCH LOGIC (Breakdown & Grouping)
// =================================================================
function getMatchesByDate(d) {
  try {
    // 🔥 Switch to External Stats Sheet ("Match End")
    const statsId = (typeof CONFIG !== 'undefined') ? CONFIG.STATS_DB_ID : PropertiesService.getScriptProperties().getProperty('STATS_DB_ID');
    const statsTab = (typeof CONFIG !== 'undefined') ? CONFIG.STATS_TAB_NAME : "Match End";

    if (!statsId) return API_UTILS.createRes(false, "STATS_DB_ID missing");
    const ss = SpreadsheetApp.openById(statsId);
    const sheet = ss.getSheetByName(statsTab);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const findCol = (keys) => headers.findIndex(h => keys.some(k => String(h).toLowerCase().includes(k.toLowerCase())));

    const idx = {
      date: findCol(["date", "วันที่"]),
      time: findCol(["time", "kickoff"]),
      league: findCol(["league", "program"]),
      home: findCol(["home", "team 1"]),
      away: findCol(["away", "team 2"])
    };

    // Timeframe: Yesterday 10:00 -> Today 10:00
    const targetDateObj = d ? new Date(d) : new Date();
    const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
    const targetDateStr = Utilities.formatDate(targetDateObj, tz, "yyyy-MM-dd");
    const prevDateObj = new Date(targetDateObj); prevDateObj.setDate(targetDateObj.getDate() - 1);
    const prevDateStr = Utilities.formatDate(prevDateObj, tz, "yyyy-MM-dd");

    const filtered = data.slice(1).filter(row => {
      const rDateStr = API_UTILS.formatDateTime(row[idx.date], 'date');
      const rTimeStr = API_UTILS.formatDateTime(row[idx.time], 'time');

      // Logic 10:00 - 10:00
      if (rDateStr === prevDateStr && rTimeStr >= "10:00") return true;
      if (rDateStr === targetDateStr && rTimeStr < "10:00") return true;
      return false;
    });

    let leagueCounts = {};
    let textList = []; // เก็บไว้เผื่อ Debug แต่ไม่ได้ใช้แสดงผลหลักแล้ว

    filtered.forEach(row => {
      let league = row[idx.league] || "Other";

      // --- 🟢 Grouping Logic (จัดกลุ่มตามที่ระบุ) ---
      let groupLeague = league;
      const lUpper = String(league).toUpperCase().trim();

      if (lUpper.includes("SV LEAGUE") && lUpper.includes("VOLLEYBALL")) groupLeague = "SV League Volleyball";
      else if (lUpper.includes("THAI WOMEN LEAGUE 1")) groupLeague = "Thai Women League 1";
      else if (lUpper.includes("THAI WOMEN LEAGUE 2")) groupLeague = "Thai Women League 2";
      else if (lUpper.includes("THAI LEAGUE")) groupLeague = "Thai League"; // 1-3
      else if (lUpper.includes("FRENCH") || lUpper.includes("LIGUE 1")) groupLeague = "French League";
      else if (lUpper.includes("PREMIER LEAGUE")) groupLeague = "Premier League";
      else if (lUpper.includes("EFL")) groupLeague = "EFL";
      else if (lUpper.includes("CARABAO")) groupLeague = "Carabao Cup";
      else if (lUpper.includes("UEFA")) groupLeague = "UEFA European";
      else if (lUpper.includes("U21")) groupLeague = "U21";
      else if (lUpper.includes("CHANG FA CUP")) groupLeague = "Chang FA Cup";
      else if (lUpper.includes("EMIRATES")) groupLeague = "The Emirates FA Cup";
      else if (lUpper.includes("MUANGTHAI")) groupLeague = "MUANGTHAI CUP";

      leagueCounts[groupLeague] = (leagueCounts[groupLeague] || 0) + 1;
    });

    return JSON.stringify({
      success: true,
      data: leagueCounts, // ส่งยอดแยกตามกลุ่ม
      total: filtered.length,
      text: "" // ปล่อยว่าง เพราะใช้ Breakdown แทนใน JS_Report
    });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
}

// =================================================================
// 3. VERIFICATION LOGIC (Match End Primary)
// =================================================================
function getVerificationReport(dateStr) {
  try {
    // 1. Match End (Primary)
    const statsId = (typeof CONFIG !== 'undefined') ? CONFIG.STATS_DB_ID : PropertiesService.getScriptProperties().getProperty('STATS_DB_ID');
    const statsTab = (typeof CONFIG !== 'undefined') ? CONFIG.STATS_TAB_NAME : "Match End";

    if (!statsId) return API_UTILS.createRes(false, "STATS_DB_ID missing");
    const ssExt = SpreadsheetApp.openById(statsId);
    const sheetExt = ssExt.getSheetByName(statsTab);
    const dataExt = sheetExt.getDataRange().getValues();
    const headersExt = dataExt[0];
    const findColExt = (keys) => headersExt.findIndex(h => keys.some(k => String(h).toLowerCase().includes(k.toLowerCase())));
    const idxExt = {
      date: findColExt(["date", "วันที่"]),
      time: findColExt(["time", "kickoff"]),
      league: findColExt(["league", "program"]),
      home: findColExt(["home", "team 1"]),
      away: findColExt(["away", "team 2"]),
      score: findColExt(["score", "ft", "ผล", "score ft"])
    };

    const targetDateObj = dateStr ? new Date(dateStr) : new Date();
    const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
    const targetDateStr = Utilities.formatDate(targetDateObj, tz, "yyyy-MM-dd");
    const prevDateObj = new Date(targetDateObj); prevDateObj.setDate(targetDateObj.getDate() - 1);
    const prevDateStr = Utilities.formatDate(prevDateObj, tz, "yyyy-MM-dd");

    const filteredExt = dataExt.slice(1).filter(row => {
      const rDateStr = API_UTILS.formatDateTime(row[idxExt.date], 'date');
      const rTimeStr = API_UTILS.formatDateTime(row[idxExt.time], 'time');
      if (rDateStr === prevDateStr && rTimeStr >= "10:00") return true;
      if (rDateStr === targetDateStr && rTimeStr < "10:00") return true;
      return false;
    });

    // 2. Dashboard (Secondary)
    const sheetDb = API_UTILS.getDbSheet();
    const dataDb = sheetDb.getDataRange().getValues();
    const headerMapDb = API_UTILS.getHeaderMap(sheetDb);
    const findColDb = (keys) => keys.find(k => headerMapDb.hasOwnProperty(k.toLowerCase()));

    const colDbDate = findColDb(["date"]);
    const colDbTime = findColDb(["time", "kickoff"]);
    const colDbHome = findColDb(["home", "team 1"]);
    const colDbAway = findColDb(["away", "team 2"]);
    const colDbStart = findColDb(["start image", "start"]);
    const colDbStop = findColDb(["stop image", "stop"]);
    const colDbLeague = findColDb(["league", "program"]);

    const filteredDb = dataDb.slice(1).filter(row => {
      const rDateStr = API_UTILS.formatDateTime(row[headerMapDb[colDbDate]], 'date');
      const rTimeStr = API_UTILS.formatDateTime(row[headerMapDb[colDbTime]], 'time');
      if (rDateStr === prevDateStr && rTimeStr >= "10:00") return true;
      if (rDateStr === targetDateStr && rTimeStr < "10:00") return true;
      return false;
    });

    const norm = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    let reportList = filteredExt.map(rowExt => {
      const homeExt = String(rowExt[idxExt.home] || "").trim();
      const awayExt = String(rowExt[idxExt.away] || "").trim();
      const timeExt = API_UTILS.formatDateTime(rowExt[idxExt.time], 'time');
      const leagueExt = rowExt[idxExt.league] || "";
      const scoreExt = (idxExt.score > -1) ? rowExt[idxExt.score] : "-";

      // Cross-Check
      const matchedDb = filteredDb.find(rowDb => {
        const hDb = norm(rowDb[headerMapDb[colDbHome]]);
        const aDb = norm(rowDb[headerMapDb[colDbAway]]);
        const hEx = norm(homeExt);
        const aEx = norm(awayExt);
        return (hDb === hEx && aDb === aEx) || (hDb === aEx && aDb === hEx);
      });

      let status = "MISSING";
      let dbData = { time: timeExt, home: homeExt, away: awayExt, league: leagueExt, startImg: "", stopImg: "" };

      if (matchedDb) {
        status = "MATCHED";
        dbData = {
          time: API_UTILS.formatDateTime(matchedDb[headerMapDb[colDbTime]], 'time'),
          home: matchedDb[headerMapDb[colDbHome]],
          away: matchedDb[headerMapDb[colDbAway]],
          league: matchedDb[headerMapDb[colDbLeague]] || leagueExt,
          startImg: colDbStart ? matchedDb[headerMapDb[colDbStart]] : "",
          stopImg: colDbStop ? matchedDb[headerMapDb[colDbStop]] : ""
        };
      }

      return {
        dashboard: dbData,
        external: { home: homeExt, away: awayExt, score: scoreExt },
        status: status
      };
    });

    reportList.sort((a, b) => a.dashboard.time.localeCompare(b.dashboard.time));
    return API_UTILS.createRes(true, { list: reportList, stats: { totalMatches: reportList.length } });

  } catch (e) { return API_UTILS.createRes(false, "Error: " + e.toString()); }
}

// =================================================================
// 4. OTHER FUNCTIONS
// =================================================================
function getDailyProofImages(dateStr) {
  try {
    const sheet = API_UTILS.getDbSheet();
    const data = sheet.getDataRange().getValues();
    const headerMap = API_UTILS.getHeaderMap(sheet);
    const findCol = (keys) => keys.find(k => headerMap.hasOwnProperty(k.toLowerCase()));

    const colDate = findCol(["date"]);
    const colTime = findCol(["time", "kickoff"]);
    const colStart = findCol(["start image", "start", "image in"]);
    const colHome = findCol(["home"]);
    const colAway = findCol(["away"]);

    let proofData = { start: [], stop: [] };
    const targetDateObj = dateStr ? new Date(dateStr) : new Date();
    const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
    const targetDateStr = Utilities.formatDate(targetDateObj, tz, "yyyy-MM-dd");
    const prevDateObj = new Date(targetDateObj); prevDateObj.setDate(targetDateObj.getDate() - 1);
    const prevDateStr = Utilities.formatDate(prevDateObj, tz, "yyyy-MM-dd");

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rDateStr = API_UTILS.formatDateTime(row[headerMap[colDate]], 'date');
      const rTimeStr = API_UTILS.formatDateTime(row[headerMap[colTime]], 'time');

      let matchFound = false;
      if (rDateStr === prevDateStr && rTimeStr >= "10:00") matchFound = true;
      else if (rDateStr === targetDateStr && rTimeStr < "10:00") matchFound = true;

      if (matchFound) {
        const home = row[headerMap[colHome]] || "?";
        const away = row[headerMap[colAway]] || "?";
        const sUrl = colStart ? row[headerMap[colStart]] : "";
        if (sUrl && String(sUrl).includes("http")) {
          proofData.start.push({ url: sUrl, label: `${home} vs ${away}` });
        }
      }
    }
    return API_UTILS.createRes(true, proofData);
  } catch (e) { return API_UTILS.createRes(false, e.toString()); }
}

function processShiftReport(formData) {
  try {
    const dbId = (typeof CONFIG !== 'undefined') ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty('CORE_SHEET_ID');
    const ss = SpreadsheetApp.openById(dbId);
    let sheet = ss.getSheetByName("DB_Reports");
    if (!sheet) { sheet = ss.insertSheet("DB_Reports"); sheet.appendRow(["Timestamp", "Report Date", "Shift", "Reporter", "Ticket Total", "Ticket Details", "Match Summary", "Transfer Report", "Chat Target"]); }

    const ts = formData.ticketStats || {};
    let chatBody = `สรุปรายงานผลการปฏิบัติงาน\nประจำวันที่: ${formData.date}\nผู้รายงาน: ${formData.reporter}\n─────────────────────────────\n\n`;

    // Ticket Summary
    chatBody += `1. สรุปสถานะ Ticket\n> Total: ${ts.total}\n> New: ${ts.new}\n> Open: ${ts.open}\n> Pending: ${ts.pending}\n> Resolved: ${ts.resolved}\n> Closed: ${ts.closed}\n\n`;

    // Channel & Transfer
    chatBody += `2. Stop channel\n> Mono: ${formData.statusMono}\n> AIS: ${formData.statusAis}\n> Start Channel: ${formData.statusStart}\n\n`;
    if (formData.transferReport) chatBody += `3. Shift Transfer\n> ${formData.transferReport}\n\n`;

    // Match Summary (Breakdown)
    chatBody += `─────────────────────────────\n4. สรุปจำนวน Match\n${formData.matchTotal ? `(Match รวม ${formData.matchTotal} คู่ / จบแล้ว ${formData.matchEnded || 0} คู่)\n` : ""}`;
    chatBody += (formData.matchSummary || "ไม่มีรายการแข่งขัน") + "\n"; // matchSummary is now Breakdown List

    if (formData.isDraft) return JSON.stringify({ success: true, isPreview: true, chatPreview: chatBody });

    sheet.appendRow([new Date(), formData.date, formData.shift, formData.reporter, ts.total, formData.ticketSummary, formData.matchSummary, formData.transferReport, formData.chatTarget]);

    if (formData.chatTarget && typeof CONFIG !== 'undefined' && CONFIG.WEBHOOKS && CONFIG.WEBHOOKS[formData.chatTarget]) {
      try { UrlFetchApp.fetch(CONFIG.WEBHOOKS[formData.chatTarget], { method: "post", contentType: "application/json", payload: JSON.stringify({ text: chatBody }) }); }
      catch (e) { console.error("Webhook Error", e); }
    }
    return JSON.stringify({ success: true });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
}

function getMasterTeamList() { return API_UTILS.createRes(true, []); }