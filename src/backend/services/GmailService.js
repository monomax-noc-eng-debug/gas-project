/**
 * src/backend/services/GmailService.js
 * Version: Preview & Select Mode (Fixed)
 */
const GmailService = (() => {
  const COMPLETE_LABEL = 'complete';

  return {
    // 1. ดึงข้อมูลมาแสดงผล (Preview) ยังไม่บันทึก
    getUnsyncedEmails: function () {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(10000)) return { success: false, message: "Server Busy" };

      try {
        const query = `subject:"Mono Max" -label:"${COMPLETE_LABEL}"`;
        const threads = GmailApp.search(query, 0, 20); // ดึง 20 รายการล่าสุด

        if (threads.length === 0) {
          return { success: true, count: 0, items: [], message: "ไม่พบอีเมลใหม่" };
        }

        // พยายามดึง ID เดิมมาเช็คซ้ำ (ถ้ามี function นี้)
        let existingIds = [];
        try {
          if (typeof TicketController.getAllTicketIds === 'function') {
            existingIds = TicketController.getAllTicketIds();
          }
        } catch (e) {
          console.warn("Skipping duplicate check from DB.", e);
        }

        const previewItems = [];

        threads.forEach((thread) => {
          const msg = thread.getMessages()[0];
          const rawSubject = msg.getSubject();
          const bodySnippet = msg.getPlainBody().substring(0, 100).replace(/[\r\n]+/g, ' ');

          let item = {
            threadId: thread.getId(),
            subject: rawSubject,
            snippet: bodySnippet,
            status: 'PENDING',
            payload: null,
            remark: ''
          };

          // 1. ตรวจสอบ SVR
          const svrMatch = rawSubject.match(/SVR\d+/i);
          if (!svrMatch) {
            item.status = 'NO_SVR';
            item.remark = 'ไม่พบรหัส SVR';
          } else {
            const svrId = svrMatch[0].toUpperCase();

            // 2. ตรวจสอบ Duplicates
            if (existingIds.includes(svrId)) {
              item.status = 'DUPLICATE';
              item.id = svrId;
              item.remark = 'มีในระบบแล้ว';
            } else {
              // 3. เตรียมข้อมูลสำหรับบันทึก (Valid)
              const svrEndIndex = svrMatch.index + svrMatch[0].length;
              let cleanSubject = rawSubject.substring(svrEndIndex).replace(/^[\s:-]+/, '').trim();
              const parts = cleanSubject.split('|').map(s => s.trim());

              item.status = 'READY';
              item.id = svrId;
              item.payload = {
                id: svrId,
                type: parts[1] || 'Request',
                status: 'Draft',
                severity: parts[2] || 'Normal',
                category: parts[3] || 'General',
                subCategory: parts[4] || '-',
                subject: cleanSubject,
                detail: `[Imported via Email]\nFrom: ${msg.getFrom()}\nSubject: ${rawSubject}\n\n${msg.getPlainBody().substring(0, 2000)}...`,
                threadId: thread.getId()
              };
            }
          }
          previewItems.push(item);
        });

        return { success: true, count: previewItems.length, items: previewItems };

      } catch (e) {
        return { success: false, message: e.toString() };
      } finally {
        lock.releaseLock();
      }
    },

    // 2. บันทึกรายการที่เลือก (Batch Save)
    saveBatchTickets: function (selectedPayloads) {
      // แปลงข้อมูลถ้าถูกส่งมาเป็น String
      let payloads = selectedPayloads;
      if (typeof payloads === 'string') {
        try { payloads = JSON.parse(payloads); } catch (e) { }
      }

      if (!payloads || !Array.isArray(payloads) || payloads.length === 0) {
        return { success: true, count: 0 };
      }

      let completeLabelObj = GmailApp.getUserLabelByName(COMPLETE_LABEL);
      if (!completeLabelObj) completeLabelObj = GmailApp.createLabel(COMPLETE_LABEL);

      let savedCount = 0;

      payloads.forEach(data => {
        // กำหนดวันที่/เวลาปัจจุบันตอนกดบันทึก
        data.date = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
        data.time = Utilities.formatDate(new Date(), "Asia/Bangkok", "HH:mm");

        // เรียก TicketController.importTicket เพื่อบันทึกลง Sheet
        const res = TicketController.importTicket(data);

        if (res.success) {
          savedCount++;
          // ติด Label Complete ที่ Thread เพื่อไม่ให้ดึงซ้ำอีก
          if (data.threadId) {
            try {
              const thread = GmailApp.getThreadById(data.threadId);
              if (thread) thread.addLabel(completeLabelObj);
            } catch (e) { console.warn("Label Error", e); }
          }
        }
      });

      if (savedCount > 0) NotificationService.triggerUpdate();
      return { success: true, count: savedCount };
    },

    createDraftTicket: function (data) {
      try {
        if (!data.to || !data.subject) return { success: false, message: "Missing To or Subject" };

        // ใช้ GmailApp.createDraft โดยใส่ htmlBody
        const draft = GmailApp.createDraft(
          data.to,
          data.subject,
          "", // Plain text body (ว่างไว้ เพราะเราใช้ HTML)
          {
            cc: data.cc || "",
            htmlBody: data.bodyHtml // <-- สำคัญ: ใส่ HTML ตรงนี้
          }
        );

        const messageId = draft.getMessage().getId();
        const threadId = draft.getMessage().getThread().getId();
        const draftUrl = `https://mail.google.com/mail/u/0/#drafts/${messageId}`;

        return { success: true, message: "Draft created!", draftUrl: draftUrl, threadId: threadId };
      } catch (e) { return { success: false, message: e.toString() }; }
    }
  };
})();