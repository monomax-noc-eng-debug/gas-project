/**
 * src/backend/API.js
 * จัดการรับส่งข้อมูลระหว่าง Frontend และ Google Sheet (Full & Fixed Version)
 */

// =================================================================
// 🌐 1. CORE & ROUTING
// =================================================================

function doGet(e) {
  return HtmlService.createTemplateFromFile("frontend/index")
    .evaluate()
    .setTitle("GAS SPA System")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getUserSettings() {
  return JSON.stringify({
    theme: "light",
    profile: {
      email: Session.getActiveUser().getEmail(),
      name: Session.getActiveUser().getEmail().split("@")[0],
      role: "Admin",
    },
  });
}

// =================================================================
// 📊 2. READ DATA (DASHBOARD)
// =================================================================

/**
 * Get matches with filtering and optional caching
 * @param {string} filterType - 'DAY' or 'MONTH'
 * @param {string} filterValue - Date string (yyyy-MM-dd or yyyy-MM)
 * @param {boolean} forceRefresh - If true, skip cache
 */
function getMatches(filterType, filterValue, forceRefresh = false) {
  try {
    const data = getDataWithCache("DB_Matches", forceRefresh);
    if (!data || data.length === 0) return JSON.stringify([]);

    const headers = data[0];
    const getIdx = (name) => {
      let idx = headers.indexOf(name);
      if (idx === -1) idx = headers.indexOf(name + "_Owner");
      if (idx === -1) idx = headers.indexOf(name + " Owner");
      return idx;
    };

    const col = {
      id: getIdx('Match ID'),
      date: getIdx('Date'),
      time: getIdx('Time'),
      league: getIdx('League'),
      home: getIdx('Home'),
      away: getIdx('Away'),
      channel: getIdx('Channel'),
      signal: getIdx('Signal'),
      status: getIdx('Status'),
      startImg: headers.indexOf('Start Image'),
      stopImg: headers.indexOf('Stop Image')
    };

    const matches = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      let rowDateRaw = row[col.date];
      let rowDateStr = "";
      if (rowDateRaw instanceof Date) {
        rowDateStr = Utilities.formatDate(rowDateRaw, CONFIG.TIMEZONE, "yyyy-MM-dd");
      } else {
        rowDateStr = String(rowDateRaw).split(" ")[0];
      }

      let isMatch = false;
      if (filterType === 'DAY') {
        if (rowDateStr === filterValue) isMatch = true;
      } else {
        if (rowDateStr.startsWith(filterValue)) isMatch = true;
      }

      if (isMatch) {
        matches.push({
          id: row[col.id],
          date: rowDateStr,
          time: _formatTime(row[col.time]),
          league: row[col.league],
          home: row[col.home],
          away: row[col.away],
          channel: row[col.channel],
          signalOwner: row[col.signal] || 'WAIT',
          status: row[col.status] || 'WAIT',
          start_img: (col.startImg > -1) ? row[col.startImg] : '',
          stop_img: (col.stopImg > -1) ? row[col.stopImg] : ''
        });
      }
    }
    matches.sort((a, b) => a.time.localeCompare(b.time));
    return JSON.stringify(matches);

  } catch (e) {
    console.error("getMatches Error:", e);
    return JSON.stringify([]);
  }
}

function getShiftHistory(forceRefresh = false) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
    const sheet = ss.getSheetByName("DB_Reports");
    const data = sheet.getDataRange().getValues();
    const headers = data.shift();

    const idxDate = headers.indexOf("Report Date");
    const idxName = headers.indexOf("Reporter");
    const idxLink = headers.indexOf("PDF Report Link");
    const idxGroup = headers.indexOf("Chat Target");

    const history = data.reverse().slice(0, 20).map(row => {
      let url = row[idxLink] || "#";
      if (url.indexOf('=HYPERLINK') !== -1) {
        const match = url.match(/"([^"]+)"/);
        if (match) url = match[1];
      }
      return {
        date: row[idxDate] ? Utilities.formatDate(new Date(row[idxDate]), CONFIG.TIMEZONE, "dd/MM/yyyy") : "-",
        name: row[idxName] || "-",
        pdfUrl: url,
        group: row[idxGroup] || "N/A"
      };
    });
    return JSON.stringify(history);
  } catch (e) {
    console.error("getShiftHistory Error:", e);
    return JSON.stringify([]);
  }
}

// =================================================================
// ✏️ 3. WRITE DATA
// =================================================================

function toggleSignalOwner(matchId, newSignal) {
  return _updateCellByMatchId(matchId, "Signal", newSignal);
}

function _updateCellByMatchId(matchId, colName, value) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const sheet = _getSheet("DB_Matches");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idxId = headers.indexOf("Match ID");

    let idxTarget = headers.indexOf(colName);
    if (idxTarget === -1) idxTarget = headers.indexOf(colName + " Owner");
    if (idxTarget === -1) idxTarget = headers.indexOf(colName + "_Owner");

    if (idxId === -1 || idxTarget === -1) throw new Error(`Column not found: ${colName}`);

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idxId]) === String(matchId)) {
        sheet.getRange(i + 1, idxTarget + 1).setValue(value);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, message: "Match ID not found" });
  } catch (e) {
    return JSON.stringify({ success: false, message: e.message });
  } finally {
    lock.releaseLock();
  }
}

function uploadMatchImage(matchId, type, base64Data, mimeType) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const folder = DriveApp.getFolderById(CONFIG.IMG_FOLDER);
    const fileName = `Match_${matchId}_${type}_${Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HHmmss")}.jpg`;
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    const file = folder.createFile(blob);
    const fileUrl = file.getUrl();

    const sheet = _getSheet("DB_Matches");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idxId = headers.indexOf("Match ID");

    let colName = (type === 'START') ? "Start Image" : "Stop Image";
    let idxTarget = headers.indexOf(colName);
    if (idxTarget === -1 && type === 'START') idxTarget = headers.indexOf("Image In");
    if (idxTarget === -1 && type === 'STOP') idxTarget = headers.indexOf("Image Out");

    if (idxTarget === -1) return JSON.stringify({ success: false, message: `ไม่พบคอลัมน์ ${colName}` });

    const idxStatus = headers.indexOf("Status");

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idxId]) === String(matchId)) {
        sheet.getRange(i + 1, idxTarget + 1).setValue(fileUrl);
        if (idxStatus !== -1) {
          const newStatus = (type === 'START') ? "LIVE" : "DONE";
          sheet.getRange(i + 1, idxStatus + 1).setValue(newStatus);
        }
        return JSON.stringify({ success: true, url: fileUrl });
      }
    }
    return JSON.stringify({ success: false, message: "Match ID not found" });
  } catch (e) {
    return JSON.stringify({ success: false, message: e.toString() });
  } finally {
    lock.releaseLock();
  }
}

// --- CRUD Functions ---

function createMatch(payload) {
  try {
    const sheet = _getSheet("DB_Matches");
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const newId = "M" + Date.now();

    let newRow = new Array(headers.length).fill("");
    const setVal = (h, v) => { const i = headers.indexOf(h); if (i !== -1) newRow[i] = v; };

    setVal("Match ID", newId);
    setVal("Date", payload.date);
    setVal("Time", payload.time);
    setVal("League", payload.league);
    setVal("Home", payload.home);
    setVal("Away", payload.away);
    setVal("Channel", payload.channel || "-");
    setVal("Status", "WAIT");
    setVal("Signal", "NON");

    sheet.appendRow(newRow);
    return JSON.stringify({ success: true, message: "เพิ่มรายการสำเร็จ" });
  } catch (e) {
    return JSON.stringify({ success: false, message: e.toString() });
  }
}

function updateMatch(payload) {
  try {
    const sheet = _getSheet("DB_Matches");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idxId = headers.indexOf("Match ID");

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idxId]) === String(payload.id)) {
        const setVal = (h, v) => { const idx = headers.indexOf(h); if (idx !== -1) sheet.getRange(i + 1, idx + 1).setValue(v); };
        setVal("Date", payload.date);
        setVal("Time", payload.time);
        setVal("League", payload.league);
        setVal("Home", payload.home);
        setVal("Away", payload.away);
        setVal("Channel", payload.channel || "-");
        return JSON.stringify({ success: true, message: "แก้ไขรายการสำเร็จ" });
      }
    }
    return JSON.stringify({ success: false, message: "ไม่พบรายการ" });
  } catch (e) {
    return JSON.stringify({ success: false, message: e.toString() });
  }
}

function deleteMatch(matchId) {
  try {
    const sheet = _getSheet("DB_Matches");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idxId = headers.indexOf("Match ID");

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idxId]) === String(matchId)) {
        sheet.deleteRow(i + 1);
        return JSON.stringify({ success: true, message: "ลบสำเร็จ" });
      }
    }
    return JSON.stringify({ success: false, message: "ไม่พบรายการ" });
  } catch (e) {
    return JSON.stringify({ success: false, message: e.toString() });
  }
}

// =================================================================
// 🔗 4. FETCH EXTERNAL DATA
// =================================================================

function getTickets(forceRefresh = false) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.TICKET_ID);
    const sheet = CONFIG.TICKET_TAB ? ss.getSheetByName(CONFIG.TICKET_TAB) : ss.getSheets()[0];
    if (!sheet) return JSON.stringify([]);

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const getIdx = (keywords) => {
      if (!Array.isArray(keywords)) keywords = [keywords];
      return headers.findIndex(h => {
        const hStr = String(h).trim().toLowerCase();
        return keywords.some(k => hStr.includes(k.toLowerCase()));
      });
    };

    const cols = {
      no: getIdx(["No.", "No", "#"]),
      date: getIdx(["Date", "วันที่"]),
      ticketNo: getIdx(["Ticket Number", "Ticket No", "เลขที่"]),
      type: getIdx(["Ticket Type", "Type"]),
      status: getIdx(["Ticket Status", "Status"]),
      severity: getIdx(["Severity", "Priority"]),
      category: getIdx(["Category"]),
      subCategory: getIdx(["Sub Category", "SubCategory"]),
      desc: getIdx(["Short Description", "Subject", "หัวข้อ"]),
      detail: getIdx(["Detail", "Description", "รายละเอียด"]),
      action: getIdx(["Action"]),
      resolvedDetail: getIdx(["Resolved detail", "Resolved Detail"]),
      resp: getIdx(["Responsibility", "Responsible"]),
      assign: getIdx(["Assign", "Assigned"]),
      remark: getIdx(["Remark", "Note"]),
      created: getIdx(["Created Date", "Created"]),
      resolved: getIdx(["Resolved Date", "Resolved"]),
      duration: getIdx(["Duration"]),
      log: getIdx(["LOG UPDATE", "Log"])
    };

    const tickets = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[cols.ticketNo] && !row[cols.date] && !row[cols.no]) continue;

      tickets.push({
        no: (cols.no > -1) ? row[cols.no] : i,
        date: normalizeDate((cols.date > -1) ? row[cols.date] : ''),
        ticketNo: (cols.ticketNo > -1) ? row[cols.ticketNo] : '',
        type: (cols.type > -1) ? row[cols.type] : '',
        status: (cols.status > -1) ? row[cols.status] : '',
        severity: (cols.severity > -1) ? row[cols.severity] : '',
        category: (cols.category > -1) ? row[cols.category] : '',
        subCategory: (cols.subCategory > -1) ? row[cols.subCategory] : '',
        desc: (cols.desc > -1) ? row[cols.desc] : '',
        detail: (cols.detail > -1) ? row[cols.detail] : '',
        action: (cols.action > -1) ? row[cols.action] : '',
        resolvedDetail: (cols.resolvedDetail > -1) ? row[cols.resolvedDetail] : '',
        resp: (cols.resp > -1) ? row[cols.resp] : '',
        assign: (cols.assign > -1) ? row[cols.assign] : '',
        remark: (cols.remark > -1) ? row[cols.remark] : '',
        created: normalizeDate((cols.created > -1) ? row[cols.created] : ''),
        resolved: normalizeDate((cols.resolved > -1) ? row[cols.resolved] : ''),
        duration: (cols.duration > -1) ? row[cols.duration] : '',
        log: (cols.log > -1) ? row[cols.log] : ''
      });
    }

    return JSON.stringify(tickets);

  } catch (e) {
    console.error("getTickets Error:", e);
    return JSON.stringify([]);
  }
}

function getTicketDetails(dateString) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.TICKET_ID);
    const sheet = CONFIG.TICKET_TAB ? ss.getSheetByName(CONFIG.TICKET_TAB) : ss.getSheets()[0];
    if (!sheet) return JSON.stringify({ success: false, error: `Tab "${CONFIG.TICKET_TAB}" not found` });

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true, list: [], stats: {}, text: "ไม่พบข้อมูล" });

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const limit = 2000;
    const startRow = Math.max(2, lastRow - limit + 1);
    const numRows = lastRow - startRow + 1;
    const data = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();

    const colIdx = {
      createdDate: headers.indexOf("Created Date"),
      date: headers.indexOf("Date"),
      id: headers.indexOf("Ticket Number"),
      status: headers.indexOf("Ticket Status"),
      detail: headers.indexOf("Short Description & Subject"),
      fullDetail: headers.indexOf("Detail"),
      resolved: headers.indexOf("Resolved Date")
    };

    const targetDateStr = dateString;
    let stats = { total: 0, open: 0, pending: 0, resolved: 0, closed: 0 };
    let ticketList = [];
    let uniqueIds = new Set();

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const ticketId = (colIdx.id > -1) ? String(row[colIdx.id]).trim() : "-";
      if (!ticketId) continue;

      let rawDateVal = "";
      if (colIdx.createdDate > -1 && row[colIdx.createdDate]) rawDateVal = row[colIdx.createdDate];
      else if (colIdx.date > -1) rawDateVal = row[colIdx.date];

      const createdDateStr = normalizeDate(rawDateVal);
      const resolvedDateStr = (colIdx.resolved > -1) ? normalizeDate(row[colIdx.resolved]) : "";
      const statusRaw = String(row[colIdx.status] || "").toLowerCase().trim();

      const isCreatedToday = (createdDateStr === targetDateStr);
      const isFinishedStatus = /succeed|success|close|done|resolved|complete|เสร็จ|ปิด/.test(statusRaw);
      const isResolvedToday = (resolvedDateStr === targetDateStr && isFinishedStatus);
      const isActiveStatus = /open|new|pending|wait|hold|in progress|รอ|เปิด/.test(statusRaw);

      if (isCreatedToday || isResolvedToday || isActiveStatus) {
        if (!uniqueIds.has(ticketId)) {
          uniqueIds.add(ticketId);

          let displayStatus = "UNKNOWN";
          if (/resolved|succeed|done|complete|เสร็จ/.test(statusRaw)) { stats.resolved++; displayStatus = "RESOLVED"; }
          else if (/close|closed|ปิด/.test(statusRaw)) { stats.closed++; displayStatus = "CLOSED"; }
          else if (/pending|wait|hold|in progress|รอ/.test(statusRaw)) { stats.pending++; displayStatus = "PENDING"; }
          else if (/open|new|เปิด/.test(statusRaw)) { stats.open++; displayStatus = "OPEN"; }
          else { stats.open++; displayStatus = statusRaw.toUpperCase(); }

          let desc = (colIdx.detail > -1) ? row[colIdx.detail] : "";
          if (!desc && colIdx.fullDetail > -1) desc = row[colIdx.fullDetail];
          if (!desc) desc = "-";

          ticketList.push({ id: ticketId, status: displayStatus, detail: String(desc).trim() });
        }
      }
    }

    stats.total = ticketList.length;
    const summaryText = `Total: ${stats.total}\nOpen: ${stats.open}\nPending: ${stats.pending}\nResolved: ${stats.resolved}\nClosed: ${stats.closed}\n\n` +
      ticketList.map(t => `[${t.status}] ${t.id} - ${t.detail}`).join("\n");

    return JSON.stringify({ success: true, list: ticketList, stats: stats, text: summaryText });

  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function getMatchesByDate(dateString) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MATCH_ID);
    const sheet = CONFIG.MATCH_TAB ? ss.getSheetByName(CONFIG.MATCH_TAB) : ss.getSheets()[0];
    if (!sheet) return JSON.stringify({ success: false, error: `Tab "${CONFIG.MATCH_TAB}" not found` });

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const getIdx = (n) => headers.findIndex((h) => String(h).toLowerCase().includes(n.toLowerCase()));
    const idx = { league: getIdx("League"), date: getIdx("Date"), time: getIdx("Time"), home: getIdx("Home"), away: getIdx("Away") };

    if (idx.league === -1 || idx.date === -1 || idx.home === -1) {
      return JSON.stringify({ success: false, error: "ไม่พบหัวตาราง League, Date หรือ Home" });
    }

    const [y, m, d] = dateString.split('-').map(Number);
    const endBound = new Date(y, m - 1, d, 6, 0, 0);
    const startBound = new Date(endBound.getTime() - 24 * 60 * 60 * 1000);

    let leagueStats = {};
    let matchCount = 0;
    let uniqueMatchKeys = new Set();

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[idx.date]) continue;
      let matchDateTime = combineDateTime(row[idx.date], row[idx.time]);
      if (!matchDateTime) continue;

      if (matchDateTime >= startBound && matchDateTime < endBound) {
        let matchKey = `${row[idx.league]}_${row[idx.home]}_${row[idx.away]}`;
        if (!uniqueMatchKeys.has(matchKey)) {
          uniqueMatchKeys.add(matchKey);
          matchCount++;
          let rawLeague = String(row[idx.league]).trim() || "Unknown League";
          leagueStats[rawLeague] = (leagueStats[rawLeague] || 0) + 1;
        }
      }
    }

    let resultText = `(รวม ${matchCount} คู่)\n`;
    const sortedLeagues = Object.keys(leagueStats).sort();
    for (let league of sortedLeagues) {
      resultText += `\n- ${league}: ${leagueStats[league]}`;
    }

    return JSON.stringify({ success: true, text: resultText, total: matchCount, data: leagueStats });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function getDailyProofImages(dateStr) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
    const sheet = ss.getSheetByName("DB_Matches");
    if (!sheet) return { success: false, error: "Sheet 'DB_Matches' not found" };

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const getIdx = (n) => headers.findIndex(h => String(h).toLowerCase().trim() === n.toLowerCase().trim());

    const colIdx = { date: getIdx("Date"), time: getIdx("Time"), home: getIdx("Home"), away: getIdx("Away"), startImg: headers.indexOf("Start Image"), stopImg: headers.indexOf("Stop Image") };

    if (colIdx.startImg === -1 || colIdx.stopImg === -1) {
      return { success: false, error: "ไม่พบคอลัมน์ 'Start Image' หรือ 'Stop Image'" };
    }

    const [y, m, d] = dateStr.split('-').map(Number);
    const endBound = new Date(y, m - 1, d, 6, 0, 0);
    const startBound = new Date(endBound.getTime() - 24 * 60 * 60 * 1000);

    let proofData = { start: [], stop: [] };

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[colIdx.date]) continue;
      let matchDateTime = combineDateTime(row[colIdx.date], row[colIdx.time]);
      if (!matchDateTime) continue;

      if (matchDateTime >= startBound && matchDateTime < endBound) {
        let sUrl = row[colIdx.startImg], eUrl = row[colIdx.stopImg];
        let home = (colIdx.home !== -1) ? row[colIdx.home] : "-";
        let away = (colIdx.away !== -1) ? row[colIdx.away] : "-";
        let matchLabel = `${home} vs ${away}`;

        if (sUrl && String(sUrl).trim() !== "") proofData.start.push({ url: sUrl, label: matchLabel });
        if (eUrl && String(eUrl).trim() !== "") proofData.stop.push({ url: eUrl, label: matchLabel });
      }
    }
    return { success: true, data: proofData };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// =================================================================
// 📝 5. REPORT GENERATION (COMPLETE)
// =================================================================

function processShiftReport(formData) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
    const sheet = ss.getSheetByName("DB_Reports");
    if (!sheet) throw new Error("Sheet 'DB_Reports' not found");

    const ts = formData.ticketStats || {};
    const matchLines = (formData.matchSummary || "").split("\n").filter(l => l.trim().startsWith("-"));
    const handoverLines = (formData.transferReport || "ไม่มีข้อมูล").split("\n");

    let chatBody = `สรุปรายงานผลการปฏิบัติงาน\nประจำวันที่: ${formData.date}\nผู้รายงาน: ${formData.reporter}\n─────────────────────────────\n\n`;
    chatBody += `1. สรุปสถานะ Ticket\n> Total: ${ts.total || 0}\n> Open: ${ts.open || 0}\n> Pending: ${ts.pending || 0}\n> Resolved: ${ts.resolved || 0}\n> Closed: ${ts.closed || 0}\n\n`;
    chatBody += `2. Stop channel\n> Mono: ${formData.statusMono}\n> AIS: ${formData.statusAis}\n> Start Channel: ${formData.statusStart}\n\n`;
    chatBody += `3. Shift Transfer\n`;
    if (handoverLines.length > 0 && handoverLines[0] !== "") {
      handoverLines.forEach(l => chatBody += `> - ${l.trim()}\n`);
    } else {
      chatBody += `> - ไม่มีข้อมูล\n`;
    }
    chatBody += `\n─────────────────────────────\n4. สรุปจำนวน Match\n${formData.matchTotal ? `(Match รวม ${formData.matchTotal} คู่ )\n\n` : ""}`;
    if (matchLines.length > 0) {
      matchLines.forEach(l => chatBody += `${l.replace("- ", "").trim()}\n`);
    } else {
      chatBody += "ไม่มีรายการแข่งขัน\n";
    }
    chatBody += `─────────────────────────────`;

    if (formData.isDraft) {
      return JSON.stringify({ success: true, isPreview: true, pdfUrl: null, chatPreview: chatBody });
    }

    const targetFolder = getOrCreateDateFolder(CONFIG.PDF_FOLDER, formData.date);
    let allImageUrls = [];
    const safeSetAttr = (element, attrs) => { try { element.setAttributes(attrs); } catch (e) { } };

    const uploadImages = (imgArray, prefix) => {
      if (!imgArray || !imgArray.length) return [];
      let blobs = [];
      const safeName = (formData.reporter || "Staff").replace(/[^a-zA-Z0-9]/g, "");
      const timeStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HHmm");
      imgArray.forEach((imgObj, i) => {
        try {
          const fileName = `${prefix}_${formData.date}_${timeStr}_${safeName}_${i + 1}.jpg`;
          const blob = Utilities.newBlob(Utilities.base64Decode(imgObj.data), imgObj.mimeType, fileName);
          const file = targetFolder.createFile(blob);
          allImageUrls.push(file.getUrl());
          blobs.push(blob);
        } catch (err) { console.error(err); }
      });
      return blobs;
    };

    const getBlobsFromUrls = (urls) => {
      if (!urls || !urls.length) return [];
      return urls.map(url => {
        try {
          let id = url.match(/id=([a-zA-Z0-9_-]+)/)?.[1] || url.split('/d/')?.[1]?.split('/')?.[0];
          if (id) { allImageUrls.push(url); return DriveApp.getFileById(id).getBlob(); }
        } catch (e) { }
        return null;
      }).filter(b => b !== null);
    };

    const blobsMono = [...uploadImages(formData.proofImages?.mono, "Mono"), ...getBlobsFromUrls(formData.autoProofUrls?.mono)];
    const blobsAis = [...uploadImages(formData.proofImages?.ais, "Ais"), ...getBlobsFromUrls(formData.autoProofUrls?.ais)];
    const blobsStart = [...uploadImages(formData.proofImages?.start, "Start"), ...getBlobsFromUrls(formData.autoProofUrls?.start)];

    const templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID);
    const tempCopy = templateFile.makeCopy(`Report_${formData.date}_${formData.reporter}`, targetFolder);
    const tempDoc = DocumentApp.openById(tempCopy.getId());
    const body = tempDoc.getBody();

    body.replaceText("{{Date}}", formData.date);
    body.replaceText("{{Reporter}}", formData.reporter);
    body.replaceText("{{Shift}}", formData.shift);

    const insertSection = (placeholder, tableData, forcePageBreakAfter) => {
      const range = body.findText(placeholder);
      if (!range) return;
      const element = range.getElement().getParent();
      const index = body.getChildIndex(element);
      const table = body.insertTable(index, tableData);
      table.setBorderWidth(1).setBorderColor("#cbd5e1");
      const headerRow = table.getRow(0);
      for (let i = 0; i < tableData[0].length; i++) {
        headerRow.getCell(i).setBackgroundColor("#1e293b").getChild(0).asParagraph().setBold(true).setForegroundColor("#ffffff");
      }
      element.removeFromParent();
      if (forcePageBreakAfter) body.insertPageBreak(body.getChildIndex(table) + 1);
    };

    insertSection("{{Ticket_Table}}", [["Category", "Amount"], ["Open", String(ts.open || 0)], ["Pending", String(ts.pending || 0)], ["Resolved", String(ts.resolved || 0)], ["Closed", String(ts.closed || 0)], ["TOTAL", String(ts.total || 0)]], true);
    const mData = [["League", "Count"]];
    if (matchLines.length) matchLines.forEach(l => mData.push([l.replace("-", "").split(":")[0].trim(), l.split(":")[1]?.trim() || "0"]));
    else mData.push(["-", "-"]);
    insertSection("{{Match_Table}}", mData, true);
    const hData = [["#", "Details"]];
    handoverLines.forEach((l, i) => hData.push([(i + 1).toString(), l.trim()]));
    insertSection("{{Handover_Table}}", hData, true);
    insertSection("{{Status_Table}}", [["Item", "Status"], ["Mono", formData.statusMono], ["AIS", formData.statusAis], ["Start", formData.statusStart]], false);

    if (blobsMono.length || blobsAis.length || blobsStart.length) {
      body.appendPageBreak();
      const h2 = body.appendParagraph("Proof of Work").setHeading(DocumentApp.ParagraphHeading.HEADING2);
      safeSetAttr(h2, { [DocumentApp.Attribute.KEEP_WITH_NEXT]: true });
      const addImgSec = (t, bs) => {
        if (!bs.length) return;
        const h3 = body.appendParagraph(t).setHeading(DocumentApp.ParagraphHeading.HEADING3);
        safeSetAttr(h3, { [DocumentApp.Attribute.KEEP_WITH_NEXT]: true });
        bs.forEach(b => { try { const img = body.appendImage(b); const w = img.getWidth(), h = img.getHeight(), ratio = 420 / w; img.setWidth(420).setHeight(h * ratio); const spc = body.appendParagraph(" "); safeSetAttr(spc, { [DocumentApp.Attribute.FONT_SIZE]: 4 }); } catch (e) { } });
        body.appendParagraph("");
      };
      addImgSec("1. Mono Proof", blobsMono);
      addImgSec("2. AIS Proof", blobsAis);
      addImgSec("3. Start Channel Proof", blobsStart);
    }

    tempDoc.saveAndClose();
    const pdfUrl = targetFolder.createFile(tempCopy.getAs(MimeType.PDF)).getUrl();
    tempCopy.setTrashed(true);

    const dbHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let newRow = new Array(dbHeaders.length).fill("");
    const setVal = (h, v) => { const i = dbHeaders.indexOf(h); if (i !== -1) newRow[i] = v; };

    setVal("Timestamp", new Date());
    setVal("Report Date", formData.date);
    setVal("Shift", formData.shift);
    setVal("Reporter", formData.reporter);
    setVal("Ticket Total", ts.total || 0);
    setVal("Ticket Open", ts.open || 0);
    setVal("Ticket Pending", ts.pending || 0);
    setVal("Ticket Resolved", ts.resolved || 0);
    setVal("Ticket Closed", ts.closed || 0);
    setVal("Ticket Details", formData.ticketSummary || "-");
    setVal("Match Summary", formData.matchSummary);
    setVal("Match Total", formData.matchTotal || 0);
    setVal("Transfer Report", formData.transferReport);
    setVal("Status Mono", formData.statusMono);
    setVal("Status AIS", formData.statusAis);
    setVal("Status Start", formData.statusStart);
    setVal("Image URLs", allImageUrls.join(",\n"));
    setVal("PDF Report Link", `=HYPERLINK("${pdfUrl}", "คลิกที่นี่")`);
    setVal("Chat Target", formData.chatTarget || "Internal");

    sheet.appendRow(newRow);

    if (formData.chatTarget && CONFIG.WEBHOOKS[formData.chatTarget]) {
      const cardPayload = {
        cardsV2: [{
          cardId: "report-card",
          card: {
            header: { title: "สรุปรายงานผลการปฏิบัติงาน", subtitle: `${formData.date} | ${formData.reporter}`, imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/PDF_file_icon.svg/400px-PDF_file_icon.svg.png", imageType: "SQUARE" },
            sections: [{ widgets: [{ textParagraph: { text: chatBody } }] }, { widgets: [{ buttonList: { buttons: [{ text: "เปิดรายงาน PDF 📄", onClick: { openLink: { url: pdfUrl } } }] } }] }]
          }
        }]
      };
      try {
        UrlFetchApp.fetch(CONFIG.WEBHOOKS[formData.chatTarget], { method: "post", contentType: "application/json", payload: JSON.stringify(cardPayload) });
      } catch (e) {
        UrlFetchApp.fetch(CONFIG.WEBHOOKS[formData.chatTarget], { method: "post", contentType: "application/json", payload: JSON.stringify({ text: chatBody + `\n📎 PDF: ${pdfUrl}` }) });
      }
    }
    return JSON.stringify({ success: true, pdfUrl: pdfUrl });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// =================================================================
// 🔧 6. HELPER FUNCTIONS
// =================================================================

function _getSheet(sheetName) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
  return ss.getSheetByName(sheetName);
}

function normalizeDate(d) {
  if (!d) return "";
  try {
    const tz = (typeof CONFIG !== 'undefined' && CONFIG.TIMEZONE) ? CONFIG.TIMEZONE : Session.getScriptTimeZone();
    if (d instanceof Date) return Utilities.formatDate(d, tz, "yyyy-MM-dd");
    let s = String(d).trim();
    let parsedDate = new Date(s);
    if (!isNaN(parsedDate.getTime())) return Utilities.formatDate(parsedDate, tz, "yyyy-MM-dd");
    s = s.split(" ")[0].replace(/[\/\.]/g, "-");
    let p = s.split("-");
    if (p.length !== 3) return "";
    let y, m, day;
    if (p[0].length === 4) { y = p[0]; m = p[1]; day = p[2]; }
    else { y = p[2]; m = p[1]; day = p[0]; }
    let yInt = parseInt(y);
    if (yInt > 2400) yInt -= 543;
    return `${yInt}-${("0" + parseInt(m)).slice(-2)}-${("0" + parseInt(day)).slice(-2)}`;
  } catch (e) { return ""; }
}

function combineDateTime(dObj, tObj) {
  let d = dObj instanceof Date ? new Date(dObj) : new Date(normalizeDate(dObj));
  if (isNaN(d.getTime())) return null;
  let h = 0, m = 0;
  if (tObj instanceof Date) { h = tObj.getHours(); m = tObj.getMinutes(); }
  else {
    let ts = String(tObj).replace(".", ":");
    if (ts.includes(":")) { let p = ts.split(":"); h = parseInt(p[0]) || 0; m = parseInt(p[1]) || 0; }
  }
  d.setHours(h, m, 0, 0);
  return d;
}

function _formatTime(val) {
  if (val instanceof Date) return Utilities.formatDate(val, CONFIG.TIMEZONE, "HH:mm");
  return String(val).replace(/'/g, "").trim();
}

function getOrCreateDateFolder(baseFolderId, dateStr) {
  try {
    const [year, month, day] = dateStr.split("-");
    const baseFolder = DriveApp.getFolderById(baseFolderId);
    const getSubFolder = (parent, name) => { const folders = parent.getFoldersByName(name); if (folders.hasNext()) return folders.next(); return parent.createFolder(name); };
    const yFolder = getSubFolder(baseFolder, year);
    const mFolder = getSubFolder(yFolder, month);
    const dFolder = getSubFolder(mFolder, day);
    return dFolder;
  } catch (e) {
    return DriveApp.getFolderById(baseFolderId);
  }
}
