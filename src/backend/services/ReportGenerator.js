const ReportGenerator = {
  // 1. Process Images (Blobs, URLs & Base64 for PDF)
  processImages: function (formData) {
    console.time("ProcessImages"); // ⏱️ จับเวลาประมวลผลรูป
    try {
      const imgFolderId = (typeof CONFIG !== 'undefined') ? CONFIG.IMG_FOLDER : "";
      const imgFolder = imgFolderId ? DriveApp.getFolderById(imgFolderId) : null;

      let uploadedUrls = [];
      let blobs = { mono: [], ais: [], start: [] };
      let pdfImages = []; // เก็บ Base64 ไว้ส่งเข้า PDF

      const handleUpload = (imgArray, prefix, targetBlobArr) => {
        if (!imgArray || !Array.isArray(imgArray)) return;
        imgArray.forEach((imgItem, idx) => {
          try {
            let blob = null;
            let fileUrl = null;

            // Case A: Object { data: "base64" } (จาก Frontend Upload)
            if (imgItem && typeof imgItem === 'object' && imgItem.data) {
              blob = Utilities.newBlob(Utilities.base64Decode(imgItem.data), imgItem.mimeType || 'image/jpeg', `${prefix}_${idx}.jpg`);
              if (imgFolder && !formData.isDraft) {
                const file = imgFolder.createFile(blob);
                fileUrl = file.getUrl();
                uploadedUrls.push(fileUrl);
              }
            }
            // Case B: Raw Base64 String
            else if (typeof imgItem === 'string' && !imgItem.startsWith('http')) {
              blob = Utilities.newBlob(Utilities.base64Decode(imgItem), 'image/jpeg', `${prefix}_${idx}.jpg`);
              if (imgFolder && !formData.isDraft) {
                const file = imgFolder.createFile(blob);
                fileUrl = file.getUrl();
                uploadedUrls.push(fileUrl);
              }
            }
            // Case C: Existing URL (Drive Link)
            else if (typeof imgItem === 'string' && imgItem.startsWith('http')) {
              let id = null;
              if (imgItem.includes('/d/')) id = imgItem.match(/\/d\/(.+?)(\/|$)/)[1];
              else if (imgItem.includes('id=')) id = imgItem.match(/id=([^&]+)/)[1];

              if (id) {
                const file = DriveApp.getFileById(id);
                blob = file.getBlob();
                fileUrl = imgItem;
                uploadedUrls.push(imgItem);
              }
            }

            if (blob) {
              targetBlobArr.push(blob);
              // 🔥 แปลงเป็น Base64 เก็บไว้สำหรับ PDF
              pdfImages.push({
                label: prefix, // ใช้ prefix เช่น "Start", "Mono" ในการค้นหาทีหลัง
                base64: Utilities.base64Encode(blob.getBytes())
              });
            }

          } catch (e) { console.warn("Img Process Error", e); }
        });
      };

      // Process all groups
      if (formData.proofImages) {
        handleUpload(formData.proofImages.mono, "Mono", blobs.mono);
        handleUpload(formData.proofImages.ais, "AIS", blobs.ais);
        handleUpload(formData.proofImages.start, "Start", blobs.start);
      }
      handleUpload(formData.autoStartUrls, "Start", blobs.start);
      handleUpload(formData.autoMonoUrls, "Mono", blobs.mono);

      console.timeEnd("ProcessImages"); // 🏁 จบเวลา
      return { blobs, urls: uploadedUrls, pdfImages };

    } catch (e) {
      console.error("ProcessImages Failed:", e);
      if (typeof console.timeEnd === 'function') try { console.timeEnd("ProcessImages"); } catch(ex){}
      return { blobs: {}, urls: [], pdfImages: [] };
    }
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

  // 3. Generate PDF (Fixed & Robust Version with Timer)
  generateShiftReportPDF: function (formData, pdfImages) {
    console.log("🚀 Starting PDF Generation...");
    console.time("TotalPDFTime"); // ⏱️ จับเวลาภาพรวม

    try {
      const rootFolderId = (typeof CONFIG !== 'undefined') ? CONFIG.PDF_FOLDER : "";
      if (!rootFolderId) throw new Error("❌ ไม่พบ CONFIG.PDF_FOLDER");

      const findImg = (keyword) => {
        if (!pdfImages || !Array.isArray(pdfImages)) return null;
        const found = pdfImages.find(img => img.label === keyword);
        return found ? found.base64 : null;
      };

      // --- 1. Fetch Ticket Data ---
      console.time("FetchTickets"); // ⏱️ จับเวลาดึงข้อมูล Ticket
      let ticketList = [];
      try {
        if (typeof TicketService !== 'undefined') {
            const detailsJson = TicketService.getTicketDetails(formData.date);
            const details = JSON.parse(detailsJson);
            if (details.success && details.list) {
                ticketList = details.list; 
            }
        }
      } catch (err) {
        console.warn("⚠️ Error fetching ticket list for PDF:", err);
      }
      console.timeEnd("FetchTickets"); // 🏁 จบเวลา Ticket

      // --- 2. Load Template ---
      console.time("LoadTemplate"); // ⏱️ จับเวลาโหลดไฟล์ HTML
      let htmlTemplate;
      // 🔥 ใช้ Path ที่เคยเทสผ่านเป็นหลัก
      const primaryPath = 'frontend/templates/HTML_ShiftReport';

      try {
        htmlTemplate = HtmlService.createTemplateFromFile(primaryPath);
        console.log(`✅ Loaded Template: ${primaryPath}`);
      } catch (e) {
        console.warn(`⚠️ Path '${primaryPath}' not found, trying fallback 'HTML_ShiftReport'...`);
        try {
            // ลองหาจากชื่อไฟล์โดดๆ (Fallback)
            htmlTemplate = HtmlService.createTemplateFromFile('HTML_ShiftReport');
        } catch(ex) {
            try {
               htmlTemplate = HtmlService.createTemplateFromFile('PDFTemplate');
            } catch(ex2) {
               throw new Error("❌ หาไฟล์ HTML Template ไม่เจอเลย (ตรวจสอบชื่อไฟล์)");
            }
        }
      }
      console.timeEnd("LoadTemplate"); // 🏁 จบเวลา Template

      // Prepare Data
      const templateData = {
        date: formData.date,
        shift: formData.shift,
        reporter: formData.reporter,
        stats: formData.ticketStats || {},
        ticketSummary: formData.ticketSummary,
        ticketList: ticketList, 
        topics: [
          {
            title: "Start Channel (เปิดสัญญาณ)",
            status: formData.statusStart,
            description: "ตรวจสอบสัญญาณภาพจาก MONO & JAS",
            image: findImg("Start"),
            caption: "ภาพยืนยันการเปิดสัญญาณ"
          },
          {
            title: "Stop Channel (Mono)",
            status: formData.statusMono,
            description: "ตรวจสอบการปิดสัญญาณช่อง Mono",
            image: findImg("Mono"),
            caption: "ภาพยืนยันจากการปิดช่อง Mono"
          },
          {
            title: "Stop Channel (AIS)",
            status: formData.statusAis,
            description: "ตรวจสอบการปิดสัญญาณช่อง AIS",
            image: findImg("AIS"),
            caption: "ภาพยืนยันจากการปิดช่อง AIS"
          },
          {
            title: "สรุปจำนวน Match",
            status: null,
            // 🔥 แก้ไขตรงนี้: ตัดส่วน "จบแล้ว" ออก เหลือแค่ Match รวม
            description: `Match รวม: ${formData.matchTotal || 0} คู่\n\n${formData.matchSummary || "ไม่มีรายการแข่งขัน"}`,
            image: null
          },
          {
            title: "สิ่งที่ฝากต่อ (Handover)",
            status: null,
            description: formData.transferReport || "ไม่มีข้อมูลเพิ่มเติม",
            image: null
          }
        ]
      };
      htmlTemplate.data = templateData;

      // --- 3. Evaluate & Convert ---
      console.time("EvaluateHTML"); // ⏱️ จับเวลาแทนค่าตัวแปรลง HTML
      const htmlContent = htmlTemplate.evaluate().getContent();
      console.timeEnd("EvaluateHTML");

      console.time("ConvertToPDF"); // ⏱️ จับเวลาแปลงเป็น PDF (ส่วนนี้มักจะนานสุดถ้าไฟล์ใหญ่)
      console.log("⏳ Converting HTML to PDF...");
      const pdfBlob = Utilities.newBlob(htmlContent, MimeType.HTML)
        .setName(`Report_${formData.date}.pdf`)
        .getAs(MimeType.PDF);
      console.timeEnd("ConvertToPDF");

      // --- 4. Save to Drive ---
      console.time("SaveToDrive"); // ⏱️ จับเวลาบันทึกลง Drive
      console.log("💾 Saving to Drive...");
      const rootFolder = DriveApp.getFolderById(rootFolderId);
      
      const reportDate = new Date(formData.date);
      const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
      const yearStr = Utilities.formatDate(reportDate, tz, "yyyy");
      const monthStr = Utilities.formatDate(reportDate, tz, "MM");

      let yearFolder = rootFolder.getFoldersByName(yearStr).hasNext() ? rootFolder.getFoldersByName(yearStr).next() : rootFolder.createFolder(yearStr);
      let targetFolder = yearFolder.getFoldersByName(monthStr).hasNext() ? yearFolder.getFoldersByName(monthStr).next() : yearFolder.createFolder(monthStr);

      const fileName = `Report_${formData.date}_${formData.reporter.replace(/\s/g, '_')}.pdf`;
      const pdfFile = targetFolder.createFile(pdfBlob).setName(fileName);
      
      try { pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
      console.timeEnd("SaveToDrive");

      const finalUrl = pdfFile.getUrl();
      console.log("✅ PDF Created:", finalUrl);
      
      console.timeEnd("TotalPDFTime"); // 🏁 จบเวลาทั้งหมด
      return finalUrl;

    } catch (e) {
      console.error("❌ PDF GENERATION FAILED:", e.message);
      if (typeof console.timeEnd === 'function') {
          try { console.timeEnd("TotalPDFTime"); } catch(ex){}
      }
      return null;
    }
  }
};