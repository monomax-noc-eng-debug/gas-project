const ReportGenerator = {
  // 1. Process Images (Blobs & URLs)
  processImages: function (formData) {
    const imgFolderId = (typeof CONFIG !== 'undefined') ? CONFIG.IMG_FOLDER : "";
    const imgFolder = imgFolderId ? DriveApp.getFolderById(imgFolderId) : null;
    let uploadedUrls = [];
    let blobs = { mono: [], ais: [], start: [] };

    const handleUpload = (imgArray, prefix, targetBlobArr) => {
      if (!imgArray || !Array.isArray(imgArray)) return;
      imgArray.forEach((imgItem, idx) => {
        try {
          // Case: Object { data: "base64" }
          if (imgItem && typeof imgItem === 'object' && imgItem.data) {
            const blob = Utilities.newBlob(Utilities.base64Decode(imgItem.data), imgItem.mimeType || 'image/jpeg', `${prefix}_${idx}.jpg`);
            targetBlobArr.push(blob);
            if (imgFolder && !formData.isDraft) {
              const file = imgFolder.createFile(blob);
              uploadedUrls.push(file.getUrl());
            }
          }
          // Case: Raw Base64 String
          else if (typeof imgItem === 'string' && !imgItem.startsWith('http')) {
            const blob = Utilities.newBlob(Utilities.base64Decode(imgItem), 'image/jpeg', `${prefix}_${idx}.jpg`);
            targetBlobArr.push(blob);
            if (imgFolder && !formData.isDraft) {
              const file = imgFolder.createFile(blob);
              uploadedUrls.push(file.getUrl());
            }
          }
          // Case: Existing URL
          else if (typeof imgItem === 'string' && imgItem.startsWith('http')) {
            let id = null;
            if (imgItem.includes('/d/')) id = imgItem.match(/\/d\/(.+?)(\/|$)/)[1];
            else if (imgItem.includes('id=')) id = imgItem.match(/id=([^&]+)/)[1];
            if (id) {
              const file = DriveApp.getFileById(id);
              targetBlobArr.push(file.getBlob());
              uploadedUrls.push(imgItem);
            }
          }
        } catch (e) { console.warn("Img Process Error", e); }
      });
    };

    if (formData.proofImages) {
      handleUpload(formData.proofImages.mono, "Mono", blobs.mono);
      handleUpload(formData.proofImages.ais, "AIS", blobs.ais);
      handleUpload(formData.proofImages.start, "Start", blobs.start);
    }
    handleUpload(formData.autoStartUrls, "AutoStart", blobs.start);
    handleUpload(formData.autoMonoUrls, "AutoMono", blobs.mono);

    return { blobs, urls: uploadedUrls };
  },

  // 2. Build Chat Card
  buildChatCard: function (formData, pdfUrl) {
    const ts = formData.ticketStats || {};
    const iconUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/PDF_file_icon.svg/1200px-PDF_file_icon.svg.png";
    const matches = (formData.matchSummary || "-").split('\n').map(m => `<b>${m}</b>`).join('<br>');

    return {
      "cardsV2": [{
        "cardId": "shift-report-" + Date.now(),
        "card": {
          "header": { "title": "สรุปรายงานผลการปฏิบัติงาน", "subtitle": `${formData.date} | ${formData.reporter}`, "imageUrl": iconUrl, "imageType": "CIRCLE" },
          "sections": [
            {
              "header": "รายละเอียด",
              "widgets": [
                { "textParagraph": { "text": `<b>ประจำวันที่:</b> ${formData.date}<br><b>ผู้รายงาน:</b> ${formData.reporter}` } },
                { "divider": {} },
                { "textParagraph": { "text": `<b>1. สรุปสถานะ Ticket</b><br>> 🟢 งานเข้าใหม่: <font color="#16a34a">${ts.new || 0}</font><br>> 🔵 ปิดได้วันนี้: <font color="#2563eb">${(Number(ts.resolved) || 0) + (Number(ts.closed) || 0)}</font><br>> 🔴 งานค้าง: <font color="#dc2626">${ts.backlog || ts.open || 0}</font>` } },
                { "textParagraph": { "text": `<b>2. Stop channel</b><br>> Mono: ${formData.statusMono}<br>> AIS: ${formData.statusAis}<br>> Start Channel: ${formData.statusStart}` } },
                { "textParagraph": { "text": `<b>3. Shift Transfer</b><br>${formData.transferReport ? formData.transferReport.split('\n').map(l => `> ${l}`).join('<br>') : "> - ไม่มีข้อมูล"}` } },
                { "divider": {} },
                { "textParagraph": { "text": `<b>4. สรุปจำนวน Match</b><br>(Match รวม ${formData.matchTotal || 0} คู่)<br><br>${matches}` } }
              ]
            },
            {
              "widgets": [{ "buttonList": { "buttons": [{ "text": "เปิดรายงาน PDF", "icon": { "knownIcon": "DESCRIPTION" }, "onClick": { "openLink": { "url": pdfUrl || "https://drive.google.com" } }, "color": { "red": 0, "green": 0.5, "blue": 1, "alpha": 1 } }] } }]
            }
          ]
        }
      }]
    };
  },

  // 3. Generate PDF
  generateShiftReportPDF: function (formData, blobData) {
    try {
      const templateId = (typeof CONFIG !== 'undefined') ? CONFIG.TEMPLATE_ID : "";
      const rootFolderId = (typeof CONFIG !== 'undefined') ? CONFIG.PDF_FOLDER : "";
      if (!templateId || !rootFolderId) throw new Error("Missing TEMPLATE_ID or PDF_FOLDER in Config");

      const reportDate = new Date(formData.date);
      const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
      const yearStr = Utilities.formatDate(reportDate, tz, "yyyy");
      const monthStr = Utilities.formatDate(reportDate, tz, "MM");

      const rootFolder = DriveApp.getFolderById(rootFolderId);
      let yearFolder = rootFolder.getFoldersByName(yearStr).hasNext() ? rootFolder.getFoldersByName(yearStr).next() : rootFolder.createFolder(yearStr);
      let targetFolder = yearFolder.getFoldersByName(monthStr).hasNext() ? yearFolder.getFoldersByName(monthStr).next() : yearFolder.createFolder(monthStr);

      const filePrefix = formData.isDraft ? "[PREVIEW] " : "";
      const fileName = `${filePrefix}Report_${formData.date}_${formData.shift}_${formData.reporter.replace(/\s/g, '_')}`;
      const docFile = DriveApp.getFileById(templateId).makeCopy(fileName, targetFolder);
      const doc = DocumentApp.openById(docFile.getId());
      const body = doc.getBody();

      body.replaceText("{{Date}}", formData.date);
      body.replaceText("{{Reporter}}", `${formData.reporter} (${formData.shift})`);

      const insertStyledTable = (placeholder, data) => {
        const range = body.findText(placeholder);
        if (!range) return null;
        const element = range.getElement();
        // Fix: หาตำแหน่งจาก Body Index ที่แท้จริง
        let parent = element.getParent();
        while (parent.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION && parent.getParent().getType() !== DocumentApp.ElementType.DOCUMENT) {
          parent = parent.getParent();
          if (!parent) return null;
        }
        const index = body.getChildIndex(parent);

        const table = body.insertTable(index + 1, data);
        table.setBorderWidth(1).setBorderColor("#cbd5e1");
        const headerRow = table.getRow(0);
        for (let i = 0; i < data[0].length; i++) {
          headerRow.getCell(i).setBackgroundColor("#1e293b").getChild(0).asParagraph().setBold(true).setForegroundColor("#ffffff");
        }
        body.removeChild(parent); // ลบ Placeholder

        try {
          if (index > 0) {
            const prev = body.getChild(index - 1);
            if (prev.getType() === DocumentApp.ElementType.PARAGRAPH) prev.setAttributes({ [DocumentApp.Attribute.KEEP_WITH_NEXT]: true });
          }
        } catch (e) { }
        return table;
      };

      // Ticket Table
      const ts = formData.ticketStats || { total: 0, open: 0, pending: 0, resolved: 0, closed: 0, new: 0, backlog: 0 };
      const resolvedTotal = (Number(ts.resolved) || 0) + (Number(ts.closed) || 0);
      const backlogTotal = ts.backlog || ts.open || 0;
      insertStyledTable("{{Ticket_Table}}", [
        ["Operational Category", "Amount (Cases)"],
        ["🟢 รายการเข้าใหม่ (New)", String(ts.new || 0)],
        ["🔵 ปิดได้วันนี้ (Resolved/Closed)", String(resolvedTotal)],
        ["🔴 งานค้าง (Backlog)", String(backlogTotal)],
        ["รวมรายการทั้งหมด (Total)", String(ts.total || 0)]
      ]);

      // Match Table
      const matchRes = JSON.parse(MatchService.getMatchesByDate(formData.date));
      const leagueData = matchRes.data || {};
      const matchTableData = [["League / Tournament", "Summary"]];
      let totalCount = 0;
      for (const [league, count] of Object.entries(leagueData)) {
        matchTableData.push([league, String(count)]);
        totalCount += count;
      }
      if (matchTableData.length === 1) matchTableData.push(["-", "-"]);
      insertStyledTable("{{Match_Table}}", matchTableData);

      // Status & Handover
      insertStyledTable("{{Status_Table}}", [
        ["System / Channel Check", "Current Status"],
        ["Mono ปิด Channel", formData.statusMono || "-"],
        ["AIS ปิด + Clear cache", formData.statusAis || "-"],
        ["Start Channel (เปิดสัญญาณ)", formData.statusStart || "-"]
      ]);

      const handoverLines = (formData.transferReport || "ไม่มีข้อมูลเพิ่มเติม").split('\n');
      const handoverData = [["#", "Handover / Issue Details"]];
      handoverLines.forEach((l, i) => handoverData.push([(i + 1).toString(), l.trim()]));
      const hTable = insertStyledTable("{{Handover_Table}}", handoverData);
      if (hTable) { hTable.setColumnWidth(0, 40); hTable.setColumnWidth(1, 410); }

      // Proof Images
      if (blobData.mono.length > 0 || blobData.ais.length > 0 || blobData.start.length > 0) {
        body.appendPageBreak();
        body.appendParagraph("5. รายงานหลักฐานการปฏิบัติงาน (Proof of Work)").setHeading(DocumentApp.ParagraphHeading.HEADING2);

        const appendImages = (title, blobs) => {
          if (!blobs || blobs.length === 0) return;
          body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING3).setSpacingBefore(15);
          blobs.forEach(blob => {
            try {
              const img = body.appendImage(blob);
              const ratio = 480 / img.getWidth();
              img.setWidth(480).setHeight(img.getHeight() * ratio);
              img.getParent().asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
              body.appendParagraph("");
            } catch (e) { console.warn("Insert img err", e); }
          });
        };
        appendImages("5.1 Mono Proof of Work:", blobData.mono);
        appendImages("5.2 AIS Proof of Work:", blobData.ais);
        appendImages("5.3 Start Channel Proof of Work:", blobData.start);
      }

      doc.saveAndClose();
      const pdfBlob = docFile.getAs(MimeType.PDF);
      const pdfFile = targetFolder.createFile(pdfBlob);
      docFile.setTrashed(true);
      pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      return pdfFile.getUrl();
    } catch (e) { console.error("PDF Error", e); return null; }
  }
};