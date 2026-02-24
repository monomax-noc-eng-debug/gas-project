const ReportGenerator = {
  // 1. Process Images (Blobs, URLs & Base64 for PDF)
  processImages: function (formData) {
    console.time("ProcessImages"); // ⏱️ จับเวลาประมวลผลรูป
    try {
      const imgFolderId =
        typeof CONFIG !== "undefined" ? CONFIG.IMG_FOLDER : "";
      const imgFolder = imgFolderId
        ? DriveApp.getFolderById(imgFolderId)
        : null;

      let uploadedUrls = [];
      let blobs = { startMono: [], stopMono: [], startAis: [], stopAis: [] };
      let pdfImages = []; // เก็บ Base64 ไว้ส่งเข้า PDF

      const handleUpload = (imgArray, prefix, targetBlobArr) => {
        if (!imgArray || !Array.isArray(imgArray)) return;
        imgArray.forEach((imgItem, idx) => {
          try {
            let blob = null;
            let fileUrl = null;

            // Case A: Object { data: "base64" } (จาก Frontend Upload)
            if (imgItem && typeof imgItem === "object" && imgItem.data) {
              blob = Utilities.newBlob(
                Utilities.base64Decode(imgItem.data),
                imgItem.mimeType || "image/jpeg",
                `${prefix}_${idx}.jpg`,
              );
              if (imgFolder && !formData.isDraft) {
                const file = imgFolder.createFile(blob);
                fileUrl = file.getUrl();
                uploadedUrls.push(fileUrl);
              }
            }
            // Case B: Raw Base64 String
            else if (
              typeof imgItem === "string" &&
              !imgItem.startsWith("http")
            ) {
              blob = Utilities.newBlob(
                Utilities.base64Decode(imgItem),
                "image/jpeg",
                `${prefix}_${idx}.jpg`,
              );
              if (imgFolder && !formData.isDraft) {
                const file = imgFolder.createFile(blob);
                fileUrl = file.getUrl();
                uploadedUrls.push(fileUrl);
              }
            }
            // Case C: Existing URL (Drive Link)
            else if (
              typeof imgItem === "string" &&
              imgItem.startsWith("http")
            ) {
              let id = null;
              if (imgItem.includes("/d/"))
                id = imgItem.match(/\/d\/(.+?)(\/|$)/)[1];
              else if (imgItem.includes("id="))
                id = imgItem.match(/id=([^&]+)/)[1];

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
                base64: Utilities.base64Encode(blob.getBytes()),
              });
            }
          } catch (e) {
            console.warn("Img Process Error", e);
          }
        });
      };

      // Process all groups
      if (formData.proofImages) {
        handleUpload(formData.proofImages.startMono, "StartMono", blobs.startMono);
        handleUpload(formData.proofImages.stopMono, "StopMono", blobs.stopMono);
        handleUpload(formData.proofImages.startAis, "StartAIS", blobs.startAis);
        handleUpload(formData.proofImages.stopAis, "StopAIS", blobs.stopAis);
      }
      handleUpload(formData.autoStartMonoUrls, "StartMono", blobs.startMono);
      handleUpload(formData.autoStopMonoUrls, "StopMono", blobs.stopMono);
      handleUpload(formData.autoStartAisUrls, "StartAIS", blobs.startAis);
      handleUpload(formData.autoStopAisUrls, "StopAIS", blobs.stopAis);

      console.timeEnd("ProcessImages"); // 🏁 จบเวลา
      return { blobs, urls: uploadedUrls, pdfImages };
    } catch (e) {
      console.error("ProcessImages Failed:", e);
      if (typeof console.timeEnd === "function")
        try {
          console.timeEnd("ProcessImages");
        } catch (ex) { }
      return { blobs: {}, urls: [], pdfImages: [] };
    }
  },

  // 2. Build Chat Card
  buildChatCard: function (formData, pdfUrl) {
    const ts = formData.ticketStats || {};
    const iconUrl =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/PDF_file_icon.svg/1200px-PDF_file_icon.svg.png";
    const matches = (formData.matchSummary || "-")
      .split("\n")
      .map((m) => `<b>${m}</b>`)
      .join("<br>");

    // ✅ ปรับปรุง: รองรับกรณี PDF สร้างไม่สำเร็จ (Graceful Degradation)
    const pdfButton = pdfUrl
      ? {
        text: "เปิดรายงาน PDF",
        icon: { knownIcon: "DESCRIPTION" },
        onClick: { openLink: { url: pdfUrl } },
        color: { red: 0, green: 0.5, blue: 1, alpha: 1 },
      }
      : {
        text: "⚠️ สร้าง PDF ไม่สำเร็จ (ตรวจสอบ Base64 รูปภาพ)",
        color: { red: 1, green: 0, blue: 0, alpha: 1 },
      };

    return {
      cardsV2: [
        {
          cardId: "shift-report-" + Date.now(),
          card: {
            header: {
              title: "สรุปรายงานผลการปฏิบัติงาน",
              subtitle: `${formData.date} | ${formData.reporter}`,
              imageUrl: iconUrl,
              imageType: "CIRCLE",
            },
            sections: [
              {
                header: "รายละเอียด",
                widgets: [
                  {
                    textParagraph: {
                      text: `<b>ประจำวันที่:</b> ${formData.date}<br><b>ผู้รายงาน:</b> ${formData.reporter}`,
                    },
                  },
                  { divider: {} },
                  {
                    textParagraph: {
                      text: `<b>1. สรุปสถานะ Ticket</b><br>> 🟢 งานเข้าใหม่: <font color="#16a34a">${ts.new || 0}</font><br>> 🔵 ปิดได้วันนี้: <font color="#2563eb">${(Number(ts.resolved) || 0) + (Number(ts.closed) || 0)}</font><br>> 🔴 งานค้าง: <font color="#dc2626">${ts.backlog || ts.open || 0}</font>`,
                    },
                  },
                  {
                    textParagraph: {
                      text: `<b>2. สถานะระบบออกสื่อ</b><br>> Start Mono: ${formData.statusStartMono || '-'}<br>> Stop Mono: ${formData.statusStopMono || '-'}<br>> Start AIS: ${formData.statusStartAis || '-'}<br>> Stop AIS: ${formData.statusStopAis || '-'}`,
                    },
                  },
                  {
                    textParagraph: {
                      text: `<b>3. Shift Transfer</b><br>${formData.transferReport
                        ? formData.transferReport
                          .split("\n")
                          .map((l) => `> ${l}`)
                          .join("<br>")
                        : "> - ไม่มีข้อมูล"
                        }`,
                    },
                  },
                  { divider: {} },
                  {
                    textParagraph: {
                      text: `<b>4. สรุปจำนวน Match</b><br>(Match รวม ${formData.matchTotal || 0} คู่)<br><br>${matches}`,
                    },
                  },
                ],
              },
              {
                widgets: [{ buttonList: { buttons: [pdfButton] } }],
              },
            ],
          },
        },
      ],
    };
  },

  // 3. Generate PDF (Fixed & Robust Version with Timer)
  generateShiftReportPDF: function (formData, pdfImages) {
    console.log("🚀 Starting PDF Generation...");
    console.time("TotalPDFTime"); // ⏱️ จับเวลาภาพรวม

    try {
      const rootFolderId =
        typeof CONFIG !== "undefined" ? CONFIG.PDF_FOLDER : "";
      if (!rootFolderId) throw new Error("❌ ไม่พบ CONFIG.PDF_FOLDER");

      const findImages = (keyword) => {
        if (!pdfImages || !Array.isArray(pdfImages)) return [];
        // Filter all images matching the label and map to their base64 content
        return pdfImages
          .filter((img) => img.label === keyword)
          .map((img) => img.base64);
      };

      // --- 1. Fetch Ticket Data ---
      console.time("FetchTickets"); // ⏱️ จับเวลาดึงข้อมูล Ticket
      let ticketList = [];
      try {
        if (typeof TicketService !== "undefined") {
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

      // ✅ ปรับปรุง: แก้ไขปัญหา GAS มองไม่เห็นไฟล์ถ้าระบุ Path เต็ม
      const templateNames = [
        "frontend/templates/HTML_ShiftReport",
        "HTML_ShiftReport",
        "PDFTemplate",
      ];

      for (const name of templateNames) {
        try {
          htmlTemplate = HtmlService.createTemplateFromFile(name);
          console.log(`✅ Loaded Template: ${name}`);
          break; // ถ้าโหลดได้แล้วให้หยุดลูป
        } catch (e) {
          console.warn(`⚠️ Template not found: ${name}`);
        }
      }

      if (!htmlTemplate) {
        throw new Error("❌ หาไฟล์ HTML Template ไม่เจอเลย (ตรวจสอบชื่อไฟล์)");
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
            title: "Start Channel (Mono)",
            status: formData.statusStartMono,
            description: "ตรวจสอบสัญญาณภาพเปิดช่อง Mono",
            images: findImages("StartMono"),
            caption: "ภาพยืนยันการเปิดสัญญาณ Mono",
          },
          {
            title: "Stop Channel (Mono)",
            status: formData.statusStopMono,
            description: "ตรวจสอบการปิดสัญญาณช่อง Mono",
            images: findImages("StopMono"),
            caption: "ภาพยืนยันจากการปิดช่อง Mono",
          },
          {
            title: "Start Channel (AIS)",
            status: formData.statusStartAis,
            description: "ตรวจสอบสัญญาณภาพเปิดช่อง AIS",
            images: findImages("StartAIS"),
            caption: "ภาพยืนยันการเปิดสัญญาณ AIS",
          },
          {
            title: "Stop Channel (AIS)",
            status: formData.statusStopAis,
            description: "ตรวจสอบการปิดสัญญาณช่อง AIS",
            images: findImages("StopAIS"),
            caption: "ภาพยืนยันจากการปิดช่อง AIS",
          },
          {
            title: "สรุปจำนวน Match",
            status: null,
            description: `Match รวม: ${formData.matchTotal || 0} คู่\n\n${formData.matchSummary || "ไม่มีรายการแข่งขัน"}`,
            images: [],
          },
          {
            title: "สิ่งที่ฝากต่อ (Handover)",
            status: null,
            description: formData.transferReport || "ไม่มีข้อมูลเพิ่มเติม",
            images: [],
          },
        ],
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
      const tz =
        typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
      const yearStr = Utilities.formatDate(reportDate, tz, "yyyy");
      const monthStr = Utilities.formatDate(reportDate, tz, "MM");

      // ✅ ปรับปรุง: ใช้ Helper ย่อการสร้าง/ค้นหาโฟลเดอร์ให้สั้นลง
      const getOrCreateFolder = (parentFolder, folderName) => {
        const folders = parentFolder.getFoldersByName(folderName);
        return folders.hasNext()
          ? folders.next()
          : parentFolder.createFolder(folderName);
      };

      const yearFolder = getOrCreateFolder(rootFolder, yearStr);
      const targetFolder = getOrCreateFolder(yearFolder, monthStr);

      const fileName = `Report_${formData.date}_${formData.reporter.replace(/\s/g, "_")}.pdf`;
      const pdfFile = targetFolder.createFile(pdfBlob).setName(fileName);

      try {
        pdfFile.setSharing(
          DriveApp.Access.ANYONE_WITH_LINK,
          DriveApp.Permission.VIEW,
        );
      } catch (e) { }
      console.timeEnd("SaveToDrive");

      const finalUrl = pdfFile.getUrl();
      console.log("✅ PDF Created:", finalUrl);

      console.timeEnd("TotalPDFTime"); // 🏁 จบเวลาทั้งหมด
      return finalUrl;
    } catch (e) {
      console.error("❌ PDF GENERATION FAILED:", e.message);
      if (typeof console.timeEnd === "function") {
        try {
          console.timeEnd("TotalPDFTime");
        } catch (ex) { }
      }
      return null;
    }
  },
};
