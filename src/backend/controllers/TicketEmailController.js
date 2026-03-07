/**
 * src/backend/controllers/TicketEmailController.js
 * 
 * Gmail & Draft operations for Ticket module.
 * Depends on: TicketController (for createTicket / updateTicket)
 * 
 * Functions moved from TicketController.js:
 *  - createTicketAndDraft
 *  - getThreadIdMap
 *  - appendThreadIdToRemark
 */
const TicketEmailController = (() => {

  const TABLE_NAME = 'Ticket';

  function _getTicketSheet() {
    const ticketId = typeof CONFIG !== 'undefined' ? CONFIG.TICKET_ID : '';
    if (!ticketId) throw new Error('Ticket ID Missing');
    const ss = SpreadsheetApp.openById(ticketId);
    return ss.getSheetByName(CONFIG.TICKET_TAB || TABLE_NAME) ||
      ss.insertSheet(CONFIG.TICKET_TAB || TABLE_NAME);
  }

  function _findColIndex(headers, keys) {
    if (!Array.isArray(keys)) keys = [keys];
    return headers.findIndex(h =>
      keys.some(k => String(h).toLowerCase().trim() === String(k).toLowerCase().trim())
    );
  }

  return {
    /**
     * สร้างหรืออัปเดต Ticket พร้อมสร้าง/ตอบกลับ Gmail Draft ในคราวเดียว
     * @param {{ ticket: Object, email: Object }} payload
     */
    createTicketAndDraft: function (payload) {
      if (!payload || typeof payload !== 'object') {
        return { success: false, message: 'createTicketAndDraft: payload missing' };
      }
      const { ticket, email } = payload;
      if (!ticket || !email) {
        return { success: false, message: 'createTicketAndDraft: ticket and email are required' };
      }

      let ticketId = ticket.id ? String(ticket.id).trim().toUpperCase() : null;
      let existingThreadId = null;
      let isUpdate = false;
      let draft;
      let draftId = '';
      let threadId = '';

      try {
        // STEP 1: อ่าน Sheet หาว่า Ticket มีอยู่แล้วหรือยัง และดึง Thread ID เดิม
        const sheet = _getTicketSheet();
        const data = sheet.getDataRange().getValues();
        const headers = data[0];
        const idCol = _findColIndex(headers, ['Ticket Number', 'ID']);
        const remarkCol = _findColIndex(headers, ['Remark', 'หมายเหตุ']);

        if (ticketId && idCol > -1) {
          for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][idCol]).trim().toUpperCase() === ticketId) {
              isUpdate = true;
              if (remarkCol > -1) {
                const remark = String(data[i][remarkCol]);
                const match = remark.match(/\[Thread ID:\s*([a-zA-Z0-9_-]+)\]/);
                if (match && match[1]) existingThreadId = match[1];
              }
              break;
            }
          }
        }

        const recipient = (email.to || '').trim();

        // STEP 2: สร้าง Gmail Draft (ตอบกลับ Thread เดิม หรือสร้างอีเมลใหม่)
        if (recipient || existingThreadId) {
          if (existingThreadId) {
            try {
              const thread = GmailApp.getThreadById(existingThreadId);
              if (thread) {
                draft = thread.createDraftReplyAll('', {
                  htmlBody: email.bodyHtml || '',
                  cc: (email.cc || '').trim(),
                });
                threadId = existingThreadId;
              }
            } catch (e) {
              console.warn('Cannot find existing thread, fallback to new email', e);
            }
          }

          if (!draft) {
            draft = GmailApp.createDraft(
              recipient,
              email.subject || '(No Subject)',
              '',
              { htmlBody: email.bodyHtml || '', cc: (email.cc || '').trim() }
            );
            try { threadId = draft.getMessage().getThread().getId(); } catch (e) { }
          }

          try { draftId = draft.getMessage().getId(); } catch (err) { draftId = draft.getId(); }
        }

        // STEP 3: ใส่ Thread ID ลง Remark ก่อนบันทึก
        if (threadId && !existingThreadId) {
          const cur = ticket.remark || '';
          if (!cur.includes(threadId)) {
            ticket.remark = cur ? `${cur}\n[Thread ID: ${threadId}]` : `[Thread ID: ${threadId}]`;
          }
        }

        // STEP 4: บันทึก Ticket ลง Sheet (1 DB Hit)
        let resVal = isUpdate
          ? TicketController.updateTicket(ticket)
          : TicketController.createTicket(ticket);

        let resObj = typeof resVal === 'string' ? JSON.parse(resVal) : resVal;
        if (!resObj.success) {
          return { success: false, message: resObj.message || 'Failed to save ticket', ticketId };
        }

        if (resObj.data && resObj.data.id) ticketId = resObj.data.id;

        return {
          success: true,
          message: draftId
            ? (existingThreadId ? 'Ticket saved & Draft Reply created' : 'Ticket saved & New Draft created')
            : 'Ticket saved (No Draft)',
          draftId,
          draftUrl: draftId ? `https://mail.google.com/mail/u/0/#drafts/${draftId}` : null,
          threadId,
          ticketId,
        };
      } catch (e) {
        console.error('createTicketAndDraft Error', e);
        return { success: false, message: 'System Error: ' + e.message, ticketId };
      }
    },

    /**
     * สร้าง Map ระหว่าง Gmail Thread ID -> Ticket ID
     * @returns {Object}
     */
    getThreadIdMap: function () {
      try {
        const sheet = _getTicketSheet();
        const data = sheet.getDataRange().getValues();
        if (data.length < 2) return {};
        const headers = data[0];
        const idCol = _findColIndex(headers, ['Ticket Number', 'ID']);
        const remarkCol = _findColIndex(headers, ['Remark', 'หมายเหตุ']);
        if (idCol === -1 || remarkCol === -1) return {};

        const map = {};
        for (let i = 1; i < data.length; i++) {
          const tid = String(data[i][idCol]).trim();
          const remark = String(data[i][remarkCol]);
          if (!tid) continue;
          const match = remark.match(/\[Thread ID:\s*([a-zA-Z0-9]+)\]/);
          if (match && match[1]) map[match[1]] = tid;
        }
        return map;
      } catch (e) {
        console.warn('getThreadIdMap Error', e);
        return {};
      }
    },

    /**
     * เพิ่ม Thread ID เข้าไปใน Remark ของ Ticket
     * @param {string} ticketId
     * @param {string} threadId
     */
    appendThreadIdToRemark: function (ticketId, threadId) {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(5000)) {
        try {
          const sheet = _getTicketSheet();
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          const idCol = _findColIndex(headers, ['Ticket Number', 'ID']);
          const remarkCol = _findColIndex(headers, ['Remark', 'หมายเหตุ']);
          if (idCol === -1 || remarkCol === -1) return;

          for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][idCol]).trim() === String(ticketId).trim()) {
              const cur = String(data[i][remarkCol]);
              if (!cur.includes(threadId)) {
                const newRemark = cur ? `${cur}\n[Thread ID: ${threadId}]` : `[Thread ID: ${threadId}]`;
                sheet.getRange(i + 1, remarkCol + 1).setValue(newRemark);

                const configId = typeof CONFIG !== 'undefined' ? CONFIG.TICKET_ID : '';
                const tab = (typeof CONFIG !== 'undefined' && CONFIG.TICKET_TAB) ? CONFIG.TICKET_TAB : TABLE_NAME;
                CacheService.getScriptCache().remove(`SHEET_DATA_${configId}_${tab}`);
              }
              break;
            }
          }
        } catch (e) {
          console.error('appendThreadIdToRemark Failed', e);
        } finally {
          lock.releaseLock();
        }
      }
    },
  };
})();
