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

function getMatches(filterType, filterValue) {
  try {
    const sheet = _getSheet("DB_Matches");
    if (!sheet) return JSON.stringify([]);

    const data = sheet.getDataRange().getValues();
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
    let targetDateStr = filterValue;

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
        if (rowDateStr === targetDateStr) isMatch = true;
      } else {
        if (rowDateStr.substring(0, 7) === filterValue) isMatch = true;
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
    return JSON.stringify([]);
  }
}

function getShiftHistory() {
  try {
    const sheet = _getSheet("DB_Reports");
    if (!sheet) return JSON.stringify([]);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return JSON.stringify([]);

    const headers = data[0];
    const idxDate = headers.indexOf("Report Date");
    const idxReporter = headers.indexOf("Reporter");
    const idxPdf = headers.indexOf("PDF Report Link");

    const logs = [];
    for (let i = data.length - 1; i >= 1 && logs.length < 20; i--) {
      const row = data[i];
      logs.push({
        date: row[idxDate] instanceof Date ? Utilities.formatDate(row[idxDate], CONFIG.TIMEZONE, "dd/MM/yyyy") : row[idxDate],
        name: row[idxReporter] || "ไม่ระบุ",
        pdfUrl: row[idxPdf] || "#",
      });
    }
    return JSON.stringify(logs);
  } catch (e) {
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

// ... (ต่อด้านล่าง: ส่วนที่ 4 และ 5)
// =================================================================
// 🔗 4. FETCH EXTERNAL DATA (LOGIC: Yesterday 06:00 -> Selected 06:00)
// =================================================================

function getMatchesByDate(dateString) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MATCH_ID);
    const sheet = CONFIG.MATCH_TAB ? ss.getSheetByName(CONFIG.MATCH_TAB) : ss.getSheets()[0];
    if (!sheet) return JSON.stringify({ success: false, error: `Tab "${CONFIG.MATCH_TAB}" not found` });

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const getIdx = (n) => headers.findIndex((h) => String(h).toLowerCase().includes(n.toLowerCase()));
    const idx = {
      league: getIdx("League"),
      date: getIdx("Date"),
      time: getIdx("Time"),
      home: getIdx("Home"),
      away: getIdx("Away"),
    };

    if (idx.league === -1 || idx.date === -1 || idx.home === -1) {
      return JSON.stringify({ success: false, error: "ไม่พบหัวตาราง League, Date หรือ Home" });
    }

    // ✅ FIXED: Parse YYYY-MM-DD Manually to avoid Timezone issues
    const [y, m, d] = dateString.split('-').map(Number);

    // ตัดรอบ: 06:00 ของวันที่เลือก (End Bound)
    const endBound = new Date(y, m - 1, d, 6, 0, 0);

    // เริ่มต้น: 06:00 ของเมื่อวาน (Start Bound)
    const startBound = new Date(endBound.getTime() - 24 * 60 * 60 * 1000);

    let leagueStats = {};
    let matchCount = 0;
    let uniqueMatchKeys = new Set();

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[idx.date]) continue;

      let matchDateTime = combineDateTime(row[idx.date], row[idx.time]);
      if (!matchDateTime) continue;

      // Filter: [เมื่อวาน 06:00] <= เวลาแข่ง < [วันนี้ 06:00]
      if (matchDateTime >= startBound && matchDateTime < endBound) {
        let matchKey = `${row[idx.league]}_${row[idx.home]}_${row[idx.away]}`;

        if (!uniqueMatchKeys.has(matchKey)) {
          uniqueMatchKeys.add(matchKey);
          matchCount++;

          let rawLeague = String(row[idx.league]).trim() || "Unknown League";
          if (leagueStats[rawLeague]) {
            leagueStats[rawLeague]++;
          } else {
            leagueStats[rawLeague] = 1;
          }
        }
      }
    }

    // สร้างข้อความสรุป
    let resultText = `(รวม ${matchCount} คู่)\n`;
    const sortedLeagues = Object.keys(leagueStats).sort();
    for (let league of sortedLeagues) {
      resultText += `\n- ${league}: ${leagueStats[league]}`;
    }

    return JSON.stringify({
      success: true,
      text: resultText,
      total: matchCount,
      data: leagueStats,
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * ดึงข้อมูล Tickets ทั้งหมดสำหรับหน้า Ticket Management
 */
function getTickets() {
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
      // Skip empty rows
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

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const getIdx = (keywords) => {
      if (!Array.isArray(keywords)) keywords = [keywords];
      return headers.findIndex(h => {
        const hStr = String(h).trim().toLowerCase();
        return keywords.some(k => hStr.includes(k.toLowerCase()));
      });
    };

    const colIdx = {
      date: getIdx(["Date", "วันที่", "Timestamp", "ประทับเวลา"]),
      id: getIdx(["Ticket Number", "Ticket ID", "No.", "เลขที่"]),
      status: getIdx(["Ticket Status", "Status", "สถานะ"]),
      detail: getIdx(["Detail", "Description", "รายละเอียด", "Issue"]),
      resolved: getIdx(["Resolved Date", "วันแก้ไข"])
    };

    if (colIdx.date === -1) return JSON.stringify({ success: false, error: "ไม่พบคอลัมน์วันที่ (Date/Timestamp)" });
    if (colIdx.status === -1) return JSON.stringify({ success: false, error: "ไม่พบคอลัมน์สถานะ (Status)" });

    const targetDateStr = dateString;
    let stats = { total: 0, open: 0, pending: 0, resolved: 0, closed: 0 };
    let detailsList = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      let rowDate = normalizeDate(row[colIdx.date]);

      if (rowDate === targetDateStr) {
        stats.total++;
        const status = String(row[colIdx.status]).toLowerCase().trim();
        const tid = (colIdx.id > -1) ? row[colIdx.id] : "-";
        const desc = (colIdx.detail > -1) ? row[colIdx.detail] : "-";

        if (status.includes("open") || status.includes("new") || status.includes("เปิด")) stats.open++;
        else if (status.includes("pending") || status.includes("wait") || status.includes("รอ")) stats.pending++;
        else if (status.includes("resolved") || status.includes("succeed") || status.includes("เสร็จ")) stats.resolved++;
        else if (status.includes("closed") || status.includes("ปิด")) stats.closed++;

        detailsList.push(`[${status.toUpperCase()}] ${tid} : ${desc}`);
      }
    }

    const summaryText = `Total: ${stats.total}\nOpen: ${stats.open}\nPending: ${stats.pending}\nResolved: ${stats.resolved}\nClosed: ${stats.closed}\n\n` + detailsList.join("\n");

    return JSON.stringify({
      success: true,
      text: summaryText,
      rawStats: stats,
      rawDetails: detailsList.join("\n"),
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// =================================================================
// 🔧 5. HELPER FUNCTIONS & REPORT PROCESSING
// =================================================================

function normalizeDate(d) {
  if (!d) return "";
  if (d instanceof Date) return Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd");
  let s = String(d).trim().split(" ")[0].replace(/[\/\.]/g, "-");
  let p = s.split("-");
  if (p.length !== 3) return "";
  let y, m, day;
  if (p[0].length === 4) { y = p[0]; m = p[1]; day = p[2]; }
  else { y = p[2]; m = p[1]; day = p[0]; }
  return `${parseInt(y)}-${("0" + parseInt(m)).slice(-2)}-${("0" + parseInt(day)).slice(-2)}`;
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

// ... CRUD Create/Update (Optional if needed) ...

function processShiftReport(formData) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
    const sheet = _getSheet("DB_Reports");
    const imgFolder = DriveApp.getFolderById(CONFIG.IMG_FOLDER);
    const pdfFolder = DriveApp.getFolderById(CONFIG.PDF_FOLDER);
    const templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID);

    let allImageUrls = [];

    const uploadImages = (imgArray, prefix) => {
      if (!imgArray || !Array.isArray(imgArray) || imgArray.length === 0) return [];
      let blobs = [];
      const safeName = (formData.reporter || "Staff").replace(/[^a-zA-Z0-9]/g, "");
      const timeStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HHmm");

      imgArray.forEach((imgObj, i) => {
        try {
          const fileName = `${prefix}_${formData.date}_${timeStr}_${safeName}_${i + 1}.jpg`;
          const blob = Utilities.newBlob(Utilities.base64Decode(imgObj.data), imgObj.mimeType, fileName);
          const file = imgFolder.createFile(blob);
          allImageUrls.push(file.getUrl());
          blobs.push(blob);
        } catch (err) { console.error(err); }
      });
      return blobs;
    };

    const blobsMono = uploadImages(formData.proofImages?.mono, "Mono");
    const blobsAis = uploadImages(formData.proofImages?.ais, "Ais");
    const blobsStart = uploadImages(formData.proofImages?.start, "Start");

    const filePrefix = formData.isDraft ? "[PREVIEW] " : "";
    const tempCopy = templateFile.makeCopy(`${filePrefix}Report_${formData.date}_${formData.reporter}`, pdfFolder);
    const tempDoc = DocumentApp.openById(tempCopy.getId());
    const body = tempDoc.getBody();

    body.replaceText("{{Date}}", formData.date);
    body.replaceText("{{Reporter}}", formData.reporter);
    body.replaceText("{{Shift}}", formData.shift);

    const insertStyledTable = (placeholder, tableData) => {
      const range = body.findText(placeholder);
      if (!range) return null;
      const element = range.getElement();
      const parent = element.getParent();
      const index = body.getChildIndex(parent);
      const table = body.insertTable(index, tableData);
      table.setBorderWidth(1).setBorderColor("#cbd5e1");
      const headerRow = table.getRow(0);
      for (let i = 0; i < tableData[0].length; i++) {
        headerRow.getCell(i).setBackgroundColor("#1e293b").getChild(0).asParagraph().setBold(true).setForegroundColor("#ffffff");
      }
      parent.removeFromParent();
      return table;
    };

    const ts = formData.ticketStats || {};
    insertStyledTable("{{Ticket_Table}}", [
      ["Category", "Amount"],
      ["Open / New", String(ts.open || 0)],
      ["Pending", String(ts.pending || 0)],
      ["Resolved", String(ts.resolved || 0)],
      ["Closed", String(ts.closed || 0)],
      ["TOTAL", String(ts.total || 0)]
    ]);

    const matchLines = (formData.matchSummary || "").split("\n").filter(l => l.trim().startsWith("-"));
    const matchTableData = [["League", "Count"]];
    if (matchLines.length > 0) {
      matchLines.forEach(line => {
        const parts = line.replace("-", "").split(":");
        matchTableData.push([parts[0].trim(), parts[1] ? parts[1].trim() : "0"]);
      });
    } else {
      matchTableData.push(["-", "-"]);
    }
    insertStyledTable("{{Match_Table}}", matchTableData);

    insertStyledTable("{{Status_Table}}", [
      ["Checklist", "Status"],
      ["Mono Channel", formData.statusMono || "-"],
      ["AIS Clear Cache", formData.statusAis || "-"],
      ["Start Channel", formData.statusStart || "-"],
    ]);

    const handoverLines = (formData.transferReport || "ไม่มีข้อมูล").split("\n");
    const handoverData = [["#", "Details"]];
    handoverLines.forEach((l, i) => handoverData.push([(i + 1).toString(), l.trim()]));
    insertStyledTable("{{Handover_Table}}", handoverData);

    if (blobsMono.length > 0 || blobsAis.length > 0 || blobsStart.length > 0) {
      body.appendPageBreak();
      body.appendParagraph("Proof of Work").setHeading(DocumentApp.ParagraphHeading.HEADING2);
      const addImgs = (title, blobs) => {
        if (!blobs || blobs.length === 0) return;
        body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING3);
        blobs.forEach(b => {
          try {
            const img = body.appendImage(b);
            const w = img.getWidth();
            const h = img.getHeight();
            const ratio = 450 / w;
            img.setWidth(450).setHeight(h * ratio);
            body.appendParagraph("");
          } catch (e) { console.warn("Image insert failed", e); }
        });
      };
      addImgs("Mono Proof:", blobsMono);
      addImgs("AIS Proof:", blobsAis);
      addImgs("Start Channel Proof:", blobsStart);
    }

    tempDoc.saveAndClose();
    const pdfUrl = tempCopy.getUrl();

    if (formData.isDraft) {
      const chatPreview = `*Shift Report Preview*\n📅 Date: ${formData.date}\n👤 Reporter: ${formData.reporter}\n\n*Ticket Stats:*\nTotal: ${ts.total}, Open: ${ts.open}\n\n*Matches:*\n${formData.matchSummary}`;
      return JSON.stringify({ success: true, isPreview: true, pdfUrl: pdfUrl, chatPreview: chatPreview });
    }

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let newRow = new Array(headers.length).fill("");
    const setVal = (h, v) => { const idx = headers.indexOf(h); if (idx !== -1) newRow[idx] = v; };

    setVal("Timestamp", new Date());
    setVal("Report Date", formData.date);
    setVal("Shift", formData.shift);
    setVal("Reporter", formData.reporter);
    setVal("Ticket Total", ts.total);
    setVal("Match Summary", formData.matchSummary);
    setVal("Image URLs", allImageUrls.join(",\n"));
    setVal("PDF Report Link", pdfUrl);

    sheet.appendRow(newRow);

    if (formData.chatTarget && CONFIG.WEBHOOKS[formData.chatTarget]) {
      const msg = `*New Report Sent*\n📅 Date: ${formData.date}\n👤 By: ${formData.reporter}\n📎 PDF: ${pdfUrl}`;
      try {
        UrlFetchApp.fetch(CONFIG.WEBHOOKS[formData.chatTarget], {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify({ text: msg }),
        });
      } catch (e) { console.warn("Webhook failed", e); }
    }

    return JSON.stringify({ success: true, pdfUrl: pdfUrl });

  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}