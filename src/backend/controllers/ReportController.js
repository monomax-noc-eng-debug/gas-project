const ReportController = {
  processShiftReport: function (formData) {
    try {
      const dbId = (typeof CONFIG !== 'undefined') ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty('CORE_SHEET_ID');
      const ss = SpreadsheetApp.openById(dbId);
      let sheet = ss.getSheetByName("DB_Reports");

      const HEADERS = [
        "Timestamp", "Report Date", "Shift", "Reporter",
        "Ticket Total", "Ticket Open", "Ticket Pending", "Ticket Resolved", "Ticket Closed",
        "Ticket Details", "Match Summary", "Match Total", "Transfer Report",
        "Status Mono", "Status AIS", "Status Start", "Image URLs", "PDF Report Link", "Chat Target"
      ];

      if (!sheet) {
        sheet = ss.insertSheet("DB_Reports");
        sheet.appendRow(HEADERS);
      }

      const ts = formData.ticketStats || {};

      // 1. Process Images (Get Blobs & Base64 for PDF)
      const imgData = ReportGenerator.processImages(formData);

      // 🟢 Preview Mode
      if (formData.isDraft) {
        let chatBody = `สรุปรายงานผลการปฏิบัติงาน (Preview)\n`;
        chatBody += `ประจำวันที่: ${formData.date}\n`;
        chatBody += `ผู้รายงาน: ${formData.reporter} (${formData.shift})\n`;
        chatBody += `─────────────────────────────\n\n`;

        chatBody += `1. สรุปสถานะ Ticket\n`;
        chatBody += `> 🟢 งานเข้าใหม่: ${ts.new || 0}\n`;
        chatBody += `> 🔵 ปิดได้วันนี้: ${(Number(ts.resolved) || 0) + (Number(ts.closed) || 0)}\n`;
        chatBody += `> 🔴 งานค้าง: ${ts.backlog || ts.open || 0}\n\n`;

        chatBody += `2. สถานะระบบออกสื่อ\n`;
        chatBody += `> Start Mono: ${formData.statusStartMono || '-'}\n`;
        chatBody += `> Stop Mono: ${formData.statusStopMono || '-'}\n`;
        chatBody += `> Start AIS: ${formData.statusStartAis || '-'}\n`;
        chatBody += `> Stop AIS: ${formData.statusStopAis || '-'}\n\n`;

        if (formData.transferReport) {
          chatBody += `3. Shift Transfer\n`;
          chatBody += formData.transferReport.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
        }

        chatBody += `─────────────────────────────\n`;
        chatBody += `4. สรุปจำนวน Match\n`;
        chatBody += `(Match รวม ${formData.matchTotal || 0} คู่ / จบแล้ว ${formData.matchEnded || 0} คู่)\n`;
        chatBody += (formData.matchSummary || 'ไม่มีรายการแข่งขัน') + '\n';

        return JSON.stringify({ success: true, isPreview: true, chatPreview: chatBody });
      }

      // 2. Generate PDF (Updated: Pass pdfImages)
      // 🔥 ส่ง base64 images ไปให้ PDF Generator
      const pdfUrl = ReportGenerator.generateShiftReportPDF(formData, imgData.pdfImages);

      // 3. Save to Sheet
      const imgString = imgData.urls.join(",\n");
      const rowData = [
        new Date(),
        formData.date,
        formData.shift,
        formData.reporter,
        ts.total || 0,
        ts.open || 0,
        ts.pending || 0,
        ts.resolved || 0,
        ts.closed || 0,
        formData.ticketSummary,
        formData.matchSummary,
        formData.matchTotal || 0,
        formData.transferReport,
        formData.statusStopMono,
        formData.statusStopAis,
        formData.statusStartMono,
        imgString,
        pdfUrl, // Link PDF ใหม่
        formData.chatTarget
      ];

      sheet.appendRow(rowData);

      // 4. Send Chat (Webhook)
      if (formData.chatTarget && typeof CONFIG !== 'undefined' && CONFIG.WEBHOOKS && CONFIG.WEBHOOKS[formData.chatTarget]) {
        try {
          const cardPayload = ReportGenerator.buildChatCard(formData, pdfUrl);
          UrlFetchApp.fetch(CONFIG.WEBHOOKS[formData.chatTarget], { method: "post", contentType: "application/json", payload: JSON.stringify(cardPayload) });
        }
        catch (e) { console.error("Webhook Error", e); }
      }
      return JSON.stringify({ success: true });

    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  },

  getShiftHistory: function () {
    try {
      const dbId = (typeof CONFIG !== 'undefined') ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty('CORE_SHEET_ID');
      const ss = SpreadsheetApp.openById(dbId);
      let sheet = ss.getSheetByName("DB_Reports");
      if (!sheet) return API_UTILS.createRes(true, []);

      const data = sheet.getDataRange().getValues();
      const history = [];

      for (let i = data.length - 1; i >= 1; i--) {
        const row = data[i];
        if (!row[1]) continue;

        history.push({
          timestamp: row[0],
          date: API_UTILS.formatDateTime(row[1], 'date'),
          shift: row[2],
          reporter: row[3],
          ticketTotal: row[4],
          ticketSummary: row[9],
          matchSummary: row[10],
          transferReport: row[12],
          chatTarget: row[18],
          pdfUrl: row[17]
        });
        if (history.length >= 50) break;
      }
      return API_UTILS.createRes(true, history);
    } catch (e) { return API_UTILS.createRes(false, e.toString()); }
  },

  getDailyProofImages: function (dateStr) {
    try {
      const sheet = API_UTILS.getDbSheet();
      const data = sheet.getDataRange().getValues();
      const headerMap = API_UTILS.getHeaderMap(sheet);

      const findCol = (keys) => {
        if (!keys) return -1;
        return keys.find(k => headerMap && headerMap.hasOwnProperty(k.toLowerCase()));
      };

      const colDate = findCol(["date"]);
      const colTime = findCol(["time", "kickoff"]);
      const colHome = findCol(["home"]);
      const colAway = findCol(["away"]);
      // New 4-column structure
      const colStartMono = findCol(["start mono"]);
      const colStopMono = findCol(["stop mono"]);
      const colStartAis = findCol(["start ais"]);
      const colStopAis = findCol(["stop ais"]);
      // Legacy fallback
      const colStart = findCol(["start image", "start", "image in"]);
      const colStop = findCol(["stop image", "stop", "image out"]);

      const extractImages = (cellValue, labelPrefix) => {
        if (!cellValue) return [];
        const val = String(cellValue).trim();
        if (val === "") return [];
        let urls = [];
        if (val.startsWith("[") && val.endsWith("]")) {
          try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) urls = parsed; } catch (e) { urls = [val]; }
        } else { urls = [val]; }
        return urls.map((u, i) => ({ url: u, label: urls.length > 1 ? `${labelPrefix} (${i + 1})` : labelPrefix }));
      };

      let proofData = { startMono: [], stopMono: [], startAis: [], stopAis: [], start: [], stop: [] };
      const targetDateObj = dateStr ? new Date(dateStr) : new Date();
      const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
      const targetDateStr = Utilities.formatDate(targetDateObj, tz, "yyyy-MM-dd");
      const prevDateObj = new Date(targetDateObj); prevDateObj.setDate(targetDateObj.getDate() - 1);
      const prevDateStr = Utilities.formatDate(prevDateObj, tz, "yyyy-MM-dd");

      if (!colDate || !colTime) {
        return API_UTILS.createRes(true, proofData);
      }

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rawDate = row[headerMap[colDate]];
        const rawTime = row[headerMap[colTime]];
        const rDateStr = API_UTILS.formatDateTime(rawDate, 'date');
        const rTimeStr = API_UTILS.formatDateTime(rawTime, 'time');

        let matchFound = false;
        if (rDateStr === prevDateStr && rTimeStr >= "10:00") matchFound = true;
        else if (rDateStr === targetDateStr && rTimeStr < "10:00") matchFound = true;

        if (matchFound) {
          const home = (colHome && row[headerMap[colHome]]) ? row[headerMap[colHome]] : "?";
          const away = (colAway && row[headerMap[colAway]]) ? row[headerMap[colAway]] : "?";
          const matchLabel = `${home} vs ${away}`;

          // New 4-column
          if (colStartMono) proofData.startMono = proofData.startMono.concat(extractImages(row[headerMap[colStartMono]], matchLabel));
          if (colStopMono) proofData.stopMono = proofData.stopMono.concat(extractImages(row[headerMap[colStopMono]], matchLabel));
          if (colStartAis) proofData.startAis = proofData.startAis.concat(extractImages(row[headerMap[colStartAis]], matchLabel));
          if (colStopAis) proofData.stopAis = proofData.stopAis.concat(extractImages(row[headerMap[colStopAis]], matchLabel));

          // Legacy fallback: populate start/stop from old columns
          if (colStart && !colStartMono) proofData.startMono = proofData.startMono.concat(extractImages(row[headerMap[colStart]], matchLabel));
          if (colStop && !colStopMono) proofData.stopMono = proofData.stopMono.concat(extractImages(row[headerMap[colStop]], matchLabel));

          // Keep legacy keys for backward compat
          proofData.start = proofData.startMono;
          proofData.stop = proofData.stopMono;
        }
      }
      return API_UTILS.createRes(true, proofData);
    } catch (e) { return API_UTILS.createRes(false, e.toString()); }
  }
};