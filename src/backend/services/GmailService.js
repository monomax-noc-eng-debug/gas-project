/**
 * src/backend/services/GmailService.js
 * Version: Manual Preview + Delimiter Parsing (Auto-hourly removed)
 */
const GmailService = (() => {
  const COMPLETE_LABEL = "complete";

  return {
    // 1. ดึงข้อมูลมาแสดงผล (Preview) รอให้ผู้ใช้กดยืนยันบันทึก
    getUnsyncedEmails: function () {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(10000))
        return { success: false, message: "Server Busy" };

      try {
        // ✨ ขยาย Query ให้ครอบคลุมทุกคีย์เวิร์ด
        const query = `(subject:"Mono Max" OR subject:"MONOMAX" OR subject:"SVR") -label:"${COMPLETE_LABEL}"`;
        const threads = GmailApp.search(query, 0, 20); // ดึง 20 รายการล่าสุด

        if (threads.length === 0) {
          return {
            success: true,
            count: 0,
            items: [],
            message: "ไม่พบอีเมลใหม่",
          };
        }

        // ดึง ID เดิมและ Map ของ Thread
        let existingIds = [];
        let threadMap = {}; // Map: { threadId: ticketId }

        try {
          if (typeof TicketController.getTicketMappings === "function") {
            const mappings = TicketController.getTicketMappings();
            existingIds = mappings.ids;
            threadMap = mappings.threadMap;
          }
        } catch (e) {
          console.warn("Skipping DB checks.", e);
        }

        const previewItems = [];

        threads.forEach((thread) => {
          const msg = thread.getMessages()[0];
          const rawSubject = msg.getSubject();
          const bodySnippet = msg
            .getPlainBody()
            .substring(0, 100)
            .replace(/[\r\n]+/g, " ");
          const threadId = thread.getId();

          let item = {
            threadId: threadId,
            subject: rawSubject,
            snippet: bodySnippet,
            status: "PENDING",
            payload: null,
            remark: "",
          };

          // ตรวจสอบ SVR Pattern
          const svrMatch = rawSubject.match(/SVR-?\d+/i);
          if (!svrMatch) {
            item.status = "NO_SVR";
            item.remark = "ไม่พบรหัส SVR";
          } else {
            const svrId = svrMatch[0].toUpperCase();

            // เช็คว่ามี Thread ID นี้ในระบบหรือไม่ (เพื่อ Update ID)
            if (threadMap[threadId]) {
              const oldId = threadMap[threadId];

              if (oldId === svrId) {
                item.status = "DUPLICATE";
                item.id = svrId;
                item.remark = "SVR ตรงกับในระบบแล้ว";
              } else if (existingIds.includes(svrId)) {
                item.status = "DUPLICATE_ID_EXIST";
                item.id = svrId;
                item.remark = `ไม่สามารถเปลี่ยน ID ได้ เพราะ ${svrId} มีอยู่แล้ว`;
              } else {
                item.status = "UPDATE_SVR";
                item.id = svrId;
                item.remark = `เปลี่ยน ID จาก ${oldId} เป็น ${svrId}`;
                item.payload = {
                  action: "UPDATE_SVR",
                  oldId: oldId,
                  newId: svrId,
                  threadId: threadId,
                };
              }
            } else {
              // กรณีไม่เจอ Thread Map (Ticket ใหม่)
              if (existingIds.includes(svrId)) {
                item.status = "DUPLICATE";
                item.id = svrId;
                item.remark = "มีในระบบแล้ว";
              } else {
                // ✨ Parsing: Use | delimiter for SVR ID pattern
                const svrEndIndex = svrMatch.index + svrMatch[0].length;
                let cleanSubject = rawSubject
                  .substring(svrEndIndex)
                  .replace(/^[\s:-]+/, "")
                  .trim();
                const parts = cleanSubject.split("|").map((s) => s.trim());

                item.status = "READY";
                item.id = svrId;
                item.payload = {
                  action: "CREATE",
                  id: svrId,
                  type: parts[1] || "Request",
                  status: "Draft", // ✨ Save as DRAFT in Sheet first
                  severity: parts[2] || "Normal",
                  category: parts[3] || "General",
                  subCategory: parts[4] || "-",
                  subject: cleanSubject,
                  detail: `[Imported via Email]\nFrom: ${msg.getFrom()}\nSubject: ${rawSubject}\n\n${msg.getPlainBody().substring(0, 2000)}...`,
                  threadId: threadId,
                };
              }
            }
          }
          previewItems.push(item);
        });

        return {
          success: true,
          count: previewItems.length,
          items: previewItems,
        };
      } catch (e) {
        return { success: false, message: e.toString() };
      } finally {
        lock.releaseLock();
      }
    },

    // 2. บันทึกรายการที่เลือก (Batch Save) แบบ Optimize ความเร็ว
    saveBatchTickets: function (selectedPayloads) {
      let payloads = selectedPayloads;
      if (typeof payloads === "string") {
        try {
          payloads = JSON.parse(payloads);
        } catch (e) {}
      }

      if (!payloads || !Array.isArray(payloads) || payloads.length === 0) {
        return { success: true, count: 0 };
      }

      let completeLabelObj = GmailApp.getUserLabelByName(COMPLETE_LABEL);
      if (!completeLabelObj)
        completeLabelObj = GmailApp.createLabel(COMPLETE_LABEL);

      let savedCount = 0;
      const updatePayloads = [];
      const createPayloads = [];

      payloads.forEach((data) => {
        if (data.action === "UPDATE_SVR") {
          updatePayloads.push(data);
        } else {
          if (!data.date)
            data.date = Utilities.formatDate(
              new Date(),
              "Asia/Bangkok",
              "yyyy-MM-dd",
            );
          if (!data.time)
            data.time = Utilities.formatDate(
              new Date(),
              "Asia/Bangkok",
              "HH:mm",
            );
          createPayloads.push(data);
        }
      });

      // จัดการ Update
      updatePayloads.forEach((data) => {
        let res = TicketController.updateTicketIdOnly(data.oldId, data.newId);
        if (res.success) {
          savedCount++;
          if (data.threadId) {
            try {
              GmailApp.getThreadById(data.threadId).addLabel(completeLabelObj);
            } catch (e) {}
          }
        }
      });

      // จัดการ Create (ส่งเข้า Batch Process)
      if (createPayloads.length > 0) {
        let batchRes = TicketController.importBatchTickets(createPayloads);
        if (batchRes.success && batchRes.count > 0) {
          savedCount += batchRes.count;
          createPayloads.forEach((data) => {
            if (data.threadId) {
              try {
                GmailApp.getThreadById(data.threadId).addLabel(
                  completeLabelObj,
                );
              } catch (e) {}
            }
          });
        }
      }

      // ✨ แจ้งเตือน Notification
      if (savedCount > 0 && typeof NotificationService !== "undefined") {
        NotificationService.triggerUpdate();
      }

      return { success: true, count: savedCount };
    },

    createDraftTicket: function (data) {
      try {
        if (!data.to || !data.subject)
          return { success: false, message: "Missing To or Subject" };

        const draft = GmailApp.createDraft(data.to, data.subject, "", {
          cc: data.cc || "",
          htmlBody: data.bodyHtml,
        });

        const messageId = draft.getMessage().getId();
        const threadId = draft.getMessage().getThread().getId();
        const draftUrl = `https://mail.google.com/mail/u/0/#drafts/${messageId}`;

        return {
          success: true,
          message: "Draft created!",
          draftUrl: draftUrl,
          threadId: threadId,
        };
      } catch (e) {
        return { success: false, message: e.toString() };
      }
    },
  };
})();
