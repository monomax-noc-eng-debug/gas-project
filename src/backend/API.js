/**
 * src/backend/API.gs
 * จัดการรับส่งข้อมูลระหว่าง Frontend และ Google Sheet (Full Version)
 */

// =================================================================
// 🌐 1. CORE & ROUTING
// =================================================================

function doGet(e) {
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("GAS SPA System")
    .addMetaTag(
      "viewport",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
    )
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getUserSettings() {
  // จำลองการดึงข้อมูล User
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
// 📊 2. READ DATA (DASHBOARD & INTERNAL DB)
// =================================================================

/**
 * ดึงข้อมูล Match จาก DB_Matches (Local DB) มาแสดงหน้า Dashboard
 */
function getMatches(filterType, filterValue) {
  try {
    const sheet = _getSheet("DB_Matches");
    if (!sheet) return JSON.stringify([]);

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    // Helper: หา Index ตามชื่อ Header
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
      // ✅ เพิ่ม: คอลัมน์เก็บ Link รูปภาพ
      startImg: headers.indexOf('Start Image'),
      stopImg: headers.indexOf('Stop Image')
    };

    const matches = [];
    let targetDateStr = filterValue; // "YYYY-MM-DD"

    for (let i = 1; i < data.length; i++) {
      const row = data[i];

      // แปลงวันที่
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
        const sigVal = (col.signal > -1) ? row[col.signal] : 'WAIT';

        matches.push({
          id: row[col.id],
          date: rowDateStr,
          time: _formatTime(row[col.time]),
          league: row[col.league],
          home: row[col.home],
          away: row[col.away],
          channel: row[col.channel],
          signalOwner: sigVal || 'WAIT',
          status: row[col.status] || 'WAIT',
          // ✅ ส่งข้อมูลรูปภาพไป Frontend
          start_img: (col.startImg > -1) ? row[col.startImg] : '',
          stop_img: (col.stopImg > -1) ? row[col.stopImg] : ''
        });
      }
    }

    matches.sort((a, b) => a.time.localeCompare(b.time));
    return JSON.stringify(matches);

  } catch (e) {
    console.error(e);
    return JSON.stringify([]);
  }
}

/**
 * ดึงประวัติการส่งกะ (History) จาก DB_Reports
 */
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

    // ดึง 20 รายการล่าสุด (ย้อนหลัง)
    const logs = [];
    for (let i = data.length - 1; i >= 1 && logs.length < 20; i--) {
      const row = data[i];
      logs.push({
        date:
          row[idxDate] instanceof Date
            ? Utilities.formatDate(row[idxDate], CONFIG.TIMEZONE, "dd/MM/yyyy")
            : row[idxDate],
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
// ✏️ 3. WRITE DATA (UPDATE STATUS)
// =================================================================

function toggleSignalOwner(matchId, newSignal) {
  return _updateCellByMatchId(matchId, "Signal", newSignal);
}

function setMatchStatus(matchId, type) {
  // type: 'IN' -> LIVE, 'OUT' -> DONE
  const statusVal = type === "IN" ? "LIVE" : "DONE";
  return _updateCellByMatchId(matchId, "Status", statusVal);
}

function _updateCellByMatchId(matchId, colName, value) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const sheet = _getSheet("DB_Matches");
    const data = sheet.getDataRange().getValues();

    const headers = data[0];
    const idxId = headers.indexOf("Match ID");
    const idxTarget = headers.indexOf(colName);

    if (idxId === -1 || idxTarget === -1)
      throw new Error(`Column not found: ${colName}`);

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

// =================================================================
// 🔗 4. FETCH EXTERNAL DATA (SMART MAPPING)
// =================================================================

/**
 * ดึงข้อมูลจากไฟล์ตารางแข่งภายนอก (ตามวันที่)
 */
function getMatchesByDate(dateString) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MATCH_ID);
    // ใช้ getSheets()[0] ถ้าไม่ระบุชื่อ Tab
    const sheet = CONFIG.MATCH_TAB
      ? ss.getSheetByName(CONFIG.MATCH_TAB)
      : ss.getSheets()[0];
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    // Smart Mapping: ค้นหา Index แบบไม่สนตัวพิมพ์เล็กใหญ่
    const getIdx = (n) =>
      headers.findIndex((h) =>
        String(h).toLowerCase().includes(n.toLowerCase()),
      );

    const idx = {
      league: getIdx("League"),
      date: getIdx("Date"),
      time: getIdx("Time"),
      home: getIdx("Home"),
      away: getIdx("Away"),
    };

    if (idx.league === -1 || idx.date === -1 || idx.home === -1) {
      return JSON.stringify({
        success: false,
        error: "ไม่พบหัวตาราง League, Date หรือ Home",
      });
    }

    // กำหนดช่วงเวลา (ตัดรอบ 10:00 น.)
    const selectedDate = new Date(dateString);
    const endBound = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
      10,
      0,
      0,
    );
    const startBound = new Date(endBound.getTime() - 24 * 60 * 60 * 1000);

    let stats = {
      "Premier League": 0,
      "Thai League 1": 0,
      "Thai League 2": 0,
      "Thai League 3": 0,
      "FA Cup": 0,
    };
    let dynamicOthers = {};
    let matchCount = 0;
    let uniqueMatchKeys = new Set();

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[idx.date]) continue;

      let matchDateTime = combineDateTime(row[idx.date], row[idx.time]);
      if (!matchDateTime) continue;

      if (matchDateTime >= startBound && matchDateTime <= endBound) {
        let matchKey = `${row[idx.league]}_${row[idx.home]}_${row[idx.away]}`;

        if (!uniqueMatchKeys.has(matchKey)) {
          uniqueMatchKeys.add(matchKey);
          matchCount++;

          let rawLeague = String(row[idx.league]).trim();
          if (stats[rawLeague] !== undefined) {
            stats[rawLeague]++;
          } else {
            dynamicOthers[rawLeague] = (dynamicOthers[rawLeague] || 0) + 1;
          }
        }
      }
    }

    let resultText = `(รวม ${matchCount} คู่)\n`;
    for (let k in stats) {
      if (stats[k] > 0) resultText += `- ${k}: ${stats[k]}\n`;
    }
    for (let k in dynamicOthers) {
      resultText += `- ${k}: ${dynamicOthers[k]}\n`;
    }

    return JSON.stringify({
      success: true,
      text: resultText,
      total: matchCount,
      data: { ...stats, ...dynamicOthers },
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * ดึงข้อมูล Ticket 5 สถานะ (Smart Mapping)
 */
function getTicketDetails(dateString) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.TICKET_ID);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    // Smart Mapping Header
    const getIdx = (n) =>
      headers.findIndex(
        (h) => String(h).trim().toLowerCase() === n.trim().toLowerCase(),
      );

    const colIdx = {
      date: getIdx("Date"),
      id: getIdx("Ticket Number"),
      status: getIdx("Ticket Status"),
      detail: getIdx("Detail"), // แก้เป็นชื่อหัวตารางจริงของคุณ
      resolved: getIdx("Resolved Date"),
    };

    if (colIdx.date === -1 || colIdx.status === -1) {
      // Fallback กรณีหาไม่เจอ ลองหาแบบกว้างๆ
      colIdx.detail = headers.findIndex((h) =>
        h.toLowerCase().includes("description"),
      );
      if (colIdx.date === -1)
        return JSON.stringify({
          success: false,
          error: "ไม่พบคอลัมน์ Date หรือ Ticket Status",
        });
    }

    const targetDateStr = dateString;
    let stats = { total: 0, open: 0, pending: 0, resolved: 0, closed: 0 };
    let detailsList = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      let rowDate = normalizeDate(row[colIdx.date]);

      if (rowDate === targetDateStr) {
        stats.total++;
        const status = String(row[colIdx.status]).toLowerCase().trim();
        const tid = row[colIdx.id];
        const desc = row[colIdx.detail] || "-";

        if (status.includes("open") || status.includes("new")) stats.open++;
        else if (status.includes("pending") || status.includes("wait"))
          stats.pending++;
        else if (status.includes("resolved") || status.includes("succeed"))
          stats.resolved++;
        else if (status.includes("closed")) stats.closed++;

        detailsList.push(`[${status.toUpperCase()}] ${tid} : ${desc}`);
      }
    }

    const summaryText =
      `Total: ${stats.total}\nOpen: ${stats.open}\nPending: ${stats.pending}\nResolved: ${stats.resolved}\nClosed: ${stats.closed}\n\n` +
      detailsList.join("\n");

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
// 📝 5. REPORT PROCESSING (MAIN LOGIC)
// =================================================================

function processShiftReport(formData) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
    const sheet = _getSheet("DB_Reports");
    const imgFolder = DriveApp.getFolderById(CONFIG.IMG_FOLDER);
    const pdfFolder = DriveApp.getFolderById(CONFIG.PDF_FOLDER);
    const templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID);

    let allImageUrls = [];

    // --- 1. Image Upload Helper ---
    const uploadImages = (imgArray, prefix) => {
      if (!imgArray || !Array.isArray(imgArray) || imgArray.length === 0)
        return [];
      let blobs = [];
      const safeName = (formData.reporter || "Staff").replace(
        /[^a-zA-Z0-9]/g,
        "",
      );
      const timeStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HHmm");

      imgArray.forEach((imgObj, i) => {
        try {
          const fileName = `${prefix}_${formData.date}_${timeStr}_${safeName}_${i + 1}.jpg`;
          const blob = Utilities.newBlob(
            Utilities.base64Decode(imgObj.data),
            imgObj.mimeType,
            fileName,
          );
          const file = imgFolder.createFile(blob);
          allImageUrls.push(file.getUrl());
          blobs.push(blob);
        } catch (err) {
          console.error("Upload Error: " + err);
        }
      });
      return blobs;
    };

    const blobsMono = uploadImages(formData.proofImages?.mono, "Mono");
    const blobsAis = uploadImages(formData.proofImages?.ais, "Ais");
    const blobsStart = uploadImages(formData.proofImages?.start, "Start");

    // --- 2. Generate PDF ---
    const filePrefix = formData.isDraft ? "[PREVIEW] " : "";
    const tempCopy = templateFile.makeCopy(
      `${filePrefix}Report_${formData.date}_${formData.reporter}`,
      pdfFolder,
    );
    const tempDoc = DocumentApp.openById(tempCopy.getId());
    const body = tempDoc.getBody();

    // Text Replacement
    body.replaceText("{{Date}}", formData.date);
    body.replaceText("{{Reporter}}", formData.reporter);
    body.replaceText("{{Shift}}", formData.shift);

    // Table Helper
    const insertStyledTable = (placeholder, tableData) => {
      const range = body.findText(placeholder);
      if (!range) return null;
      const element = range.getElement();
      const parent = element.getParent();
      const index = body.getChildIndex(parent);
      const table = body.insertTable(index, tableData);

      // Style
      table.setBorderWidth(1).setBorderColor("#cbd5e1");
      const headerRow = table.getRow(0);
      for (let i = 0; i < tableData[0].length; i++) {
        headerRow
          .getCell(i)
          .setBackgroundColor("#1e293b")
          .getChild(0)
          .asParagraph()
          .setBold(true)
          .setForegroundColor("#ffffff");
      }
      parent.removeFromParent(); // ลบ Placeholder ทิ้ง
      return table;
    };

    // Insert Tables
    const ts = formData.ticketStats || {
      total: 0,
      open: 0,
      pending: 0,
      resolved: 0,
      closed: 0,
    };
    insertStyledTable("{{Ticket_Table}}", [
      ["Category", "Amount"],
      ["Open / New", String(ts.open)],
      ["Pending", String(ts.pending)],
      ["Resolved", String(ts.resolved)],
      ["Closed", String(ts.closed)],
      ["TOTAL", String(ts.total)],
    ]);

    const matchLines = (formData.matchSummary || "")
      .split("\n")
      .filter((l) => l.trim() !== "");
    const matchTableData = [["League", "Count"]];
    if (matchLines.length > 0) {
      matchLines.forEach((line) => {
        const parts = line.split(":");
        matchTableData.push([parts[0] || "-", parts[1] || "-"]);
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

    const handoverLines = (formData.transferReport || "ไม่มีข้อมูล").split(
      "\n",
    );
    const handoverData = [["#", "Details"]];
    handoverLines.forEach((l, i) =>
      handoverData.push([(i + 1).toString(), l.trim()]),
    );
    insertStyledTable("{{Handover_Table}}", handoverData);

    // Append Images
    if (blobsMono.length > 0 || blobsAis.length > 0 || blobsStart.length > 0) {
      body.appendPageBreak();
      body
        .appendParagraph("Proof of Work")
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);

      const addImgs = (title, blobs) => {
        if (!blobs || blobs.length === 0) return;
        body
          .appendParagraph(title)
          .setHeading(DocumentApp.ParagraphHeading.HEADING3);
        blobs.forEach((b) => {
          const img = body.appendImage(b);
          const w = img.getWidth();
          const h = img.getHeight();
          const ratio = 450 / w;
          img.setWidth(450).setHeight(h * ratio);
          body.appendParagraph(""); // spacer
        });
      };

      addImgs("Mono Proof:", blobsMono);
      addImgs("AIS Proof:", blobsAis);
      addImgs("Start Channel Proof:", blobsStart);
    }

    tempDoc.saveAndClose();
    const pdfUrl = tempCopy.getUrl();

    // --- 3. Return Preview if Draft ---
    if (formData.isDraft) {
      return JSON.stringify({ success: true, isPreview: true, pdfUrl: pdfUrl });
    }

    // --- 4. Save to Sheet DB_Reports ---
    const headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0];
    let newRow = new Array(headers.length).fill("");
    const setVal = (h, v) => {
      const idx = headers.indexOf(h);
      if (idx !== -1) newRow[idx] = v;
    };

    setVal("Timestamp", new Date());
    setVal("Report Date", formData.date);
    setVal("Shift", formData.shift);
    setVal("Reporter", formData.reporter);

    setVal("Ticket Total", ts.total);
    setVal("Ticket Open", ts.open);
    setVal("Ticket Pending", ts.pending);
    setVal("Ticket Resolved", ts.resolved);
    setVal("Ticket Closed", ts.closed);
    setVal("Ticket Details", formData.ticketDetails);

    setVal("Match Summary", formData.matchSummary);
    setVal("Match Total", formData.matchTotal);
    setVal("Transfer Report", formData.transferReport);
    setVal("Status Mono", formData.statusMono);
    setVal("Status AIS", formData.statusAis);
    setVal("Status Start", formData.statusStart);
    setVal("Image URLs", allImageUrls.join(",\n"));
    setVal("PDF Report Link", pdfUrl);

    sheet.appendRow(newRow);

    // --- 5. Webhook Notification ---
    if (formData.chatTarget && CONFIG.WEBHOOKS[formData.chatTarget]) {
      const msg = `*New Report Sent*\n📅 Date: ${formData.date}\n👤 By: ${formData.reporter}\n📋 Shift: ${formData.shift}\n📎 PDF: ${pdfUrl}`;
      UrlFetchApp.fetch(CONFIG.WEBHOOKS[formData.chatTarget], {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ text: msg }),
      });
    }

    return JSON.stringify({ success: true, pdfUrl: pdfUrl });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// =================================================================
// 🛠️ 6. HELPER FUNCTIONS
// =================================================================

function normalizeDate(d) {
  if (!d) return "";
  if (d instanceof Date)
    return Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd");
  let s = String(d)
    .trim()
    .replace(/[\/\.]/g, "-"),
    p = s.split("-");
  if (p.length !== 3) return "";
  let y = parseInt(p[0].length === 4 ? p[0] : p[2]);
  let m = parseInt(p[1]);
  let day = parseInt(p[0].length === 4 ? p[2] : p[0]);
  return `${y}-${("0" + m).slice(-2)}-${("0" + day).slice(-2)}`;
}

function combineDateTime(dObj, tObj) {
  let d = dObj instanceof Date ? new Date(dObj) : new Date(normalizeDate(dObj));
  if (isNaN(d.getTime())) return null;
  let h = 0,
    m = 0;
  if (tObj instanceof Date) {
    h = tObj.getHours();
    m = tObj.getMinutes();
  } else {
    let ts = String(tObj).replace(".", ":");
    if (ts.includes(":")) {
      let p = ts.split(":");
      h = parseInt(p[0]) || 0;
      m = parseInt(p[1]) || 0;
    }
  }
  d.setHours(h, m, 0, 0);
  return d;
}

function _formatTime(val) {
  if (val instanceof Date)
    return Utilities.formatDate(val, CONFIG.TIMEZONE, "HH:mm");
  return String(val).replace(/'/g, "").trim();
}

// =================================================================
// 📧 7. EMAIL (OPTIONAL/EXTRA)
// =================================================================

function getEmailTemplates() {
  return JSON.stringify([
    { id: "DAILY", name: "Daily Summary" },
    { id: "INCIDENT", name: "Incident Report" },
  ]);
}

function getEmailPreview(templateId, note) {
  const content = _generateEmailContent(templateId, note);
  return JSON.stringify(content);
}

function createDraftEmail(templateId, to, cc, note) {
  const content = _generateEmailContent(templateId, note);
  const draft = GmailApp.createDraft(to, content.subject, "", {
    htmlBody: content.body,
    cc: cc,
  });
  return JSON.stringify({ success: true, message: "Draft created" });
}

function _generateEmailContent(templateId, note) {
  const dateStr = Utilities.formatDate(
    new Date(),
    CONFIG.TIMEZONE,
    "dd/MM/yyyy HH:mm",
  );
  let subject = `Note - ${dateStr}`;
  let body = `<p>${note}</p>`;

  if (templateId === "DAILY") {
    subject = `[Daily] Report - ${dateStr}`;
    body = `<h3>Daily Report</h3><p>${note}</p>`;
  } else if (templateId === "INCIDENT") {
    subject = `[ALERT] Incident - ${dateStr}`;
    body = `<h3 style="color:red">Incident Report</h3><p>${note}</p>`;
  }
  return { subject, body };
}

/**
 * ลบ Match ออกจาก Sheet
 */
function deleteMatch(matchId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const sheet = _getSheet("DB_Matches");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idxId = headers.indexOf("Match ID");

    if (idxId === -1) return JSON.stringify({ success: false, message: "Column Match ID not found" });

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idxId]) === String(matchId)) {
        sheet.deleteRow(i + 1);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, message: "Match not found" });

  } catch (e) {
    return JSON.stringify({ success: false, message: e.toString() });
  } finally {
    lock.releaseLock();
  }
}

// =================================================================
// 📸 IMAGE UPLOAD SECTION (แก้ไขส่วนนี้)
// =================================================================

// ✅ Helper Function: สร้างโฟลเดอร์ (แปะไว้ล่างสุดของไฟล์หรือบนสุดก็ได้)
function _getOrCreateSubFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  } else {
    return parentFolder.createFolder(folderName);
  }
}

// ✅ Main Function: แก้ไขให้สร้างโฟลเดอร์ตามวันที่
function uploadMatchImage(matchId, type, base64Data, mimeType) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    // 1. จัดการโฟลเดอร์ (Root > Year > Month > Day)
    const rootFolderId = CONFIG.IMG_FOLDER;
    const rootFolder = DriveApp.getFolderById(rootFolderId);

    const now = new Date();
    const yearStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy");
    const monthStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "MM");
    const dayStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "dd");

    // สร้างทีละชั้น
    const yearFolder = _getOrCreateSubFolder(rootFolder, yearStr);
    const monthFolder = _getOrCreateSubFolder(yearFolder, monthStr);
    const dayFolder = _getOrCreateSubFolder(monthFolder, dayStr);

    // 2. สร้างไฟล์ในโฟลเดอร์วัน (Day Folder)
    const fileName = `Match_${matchId}_${type}_${Utilities.formatDate(now, CONFIG.TIMEZONE, "HHmmss")}.jpg`;
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);

    const file = dayFolder.createFile(blob);
    const fileUrl = file.getUrl();

    // 3. บันทึก URL ลง Sheet
    const sheet = _getSheet("DB_Matches");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idxId = headers.indexOf("Match ID");

    // หาคอลัมน์ (รองรับชื่อ Start Image / Image In)
    let colName = (type === 'START') ? "Start Image" : "Stop Image";
    let idxTarget = headers.indexOf(colName);
    if (idxTarget === -1 && type === 'START') idxTarget = headers.indexOf("Image In");
    if (idxTarget === -1 && type === 'STOP') idxTarget = headers.indexOf("Image Out");

    if (idxTarget === -1) {
      return JSON.stringify({ success: false, message: `ไม่พบคอลัมน์ ${colName} ใน Sheet` });
    }

    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idxId]) === String(matchId)) {
        sheet.getRange(i + 1, idxTarget + 1).setValue(fileUrl);
        found = true;
        break;
      }
    }

    if (!found) return JSON.stringify({ success: false, message: "Match ID not found" });

    return JSON.stringify({ success: true, url: fileUrl });

  } catch (e) {
    return JSON.stringify({ success: false, message: e.toString() });
  } finally {
    lock.releaseLock();
  }
}