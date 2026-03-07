/**
 * src/backend/controllers/TicketImportController.js
 *
 * Batch & Single import operations for Ticket from Gmail.
 *
 * Functions moved from TicketController.js:
 *  - importTicket
 *  - importBatchTickets
 *  - getTicketMappings
 */
const TicketImportController = (() => {

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

  function _setCellFormat(sheet, row, colIndex, format) {
    if (row > 0 && colIndex > -1) sheet.getRange(row, colIndex + 1).setNumberFormat(format);
  }

  function _clearTicketCache() {
    const configId = typeof CONFIG !== 'undefined' ? CONFIG.TICKET_ID : '';
    const tab = (typeof CONFIG !== 'undefined' && CONFIG.TICKET_TAB) ? CONFIG.TICKET_TAB : TABLE_NAME;
    try { CacheService.getScriptCache().remove(`SHEET_DATA_${configId}_${tab}`); } catch (e) { }
  }

  return {
    /**
     * นำเข้า Ticket เดียวจาก Gmail (Legacy – ใช้กับ importTicket เดิม)
     * @param {Object} data
     */
    importTicket: function (data) {
      if (!data || typeof data !== 'object') return { success: false, message: 'importTicket: payload missing' };
      if (!data.id) return { success: false, message: 'importTicket: field "id" is required' };

      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getTicketSheet();
          const rawData = sheet.getDataRange().getValues();
          const headers = rawData[0];

          const idCol = _findColIndex(headers, ['Ticket Number', 'ID']);
          const noCol = _findColIndex(headers, ['No.', 'ลำดับ']);
          const checkCol = _findColIndex(headers, ['Short Description & Subject', 'Subject', 'หัวข้อ']);

          if (idCol > -1 && rawData.length > 1) {
            const ids = rawData.slice(1).map(row => String(row[idCol]).trim());
            if (ids.includes(data.id)) return { success: false, message: 'Duplicate ID' };
          }

          let insertRowIndex = -1;
          let existingNo = null;
          if (checkCol > -1) {
            const emptyIdx = rawData.findIndex((row, i) => i > 0 && String(row[checkCol]).trim() === '');
            if (emptyIdx !== -1) {
              insertRowIndex = emptyIdx + 1;
              if (noCol > -1) existingNo = rawData[emptyIdx][noCol];
            }
          }

          let newRow = insertRowIndex > -1 ? [...rawData[insertRowIndex - 1]] : new Array(headers.length).fill('');

          const setRowVal = (keys, val) => {
            const idx = _findColIndex(headers, keys);
            if (idx > -1) newRow[idx] = val;
          };

          const today = new Date();
          let importDate = today;
          if (data.date) importDate = new Date(`${data.date}T${data.time || '00:00'}:00`);

          if (!(insertRowIndex > -1 && existingNo)) setRowVal(['No.', 'ลำดับ'], rawData.length);

          setRowVal(['Date', 'วันที่แจ้ง'], importDate);
          setRowVal(['Ticket Number', 'ID'], data.id);
          setRowVal(['Ticket Type', 'Type'], data.type || 'Request');
          setRowVal(['Ticket Status', 'Status'], data.status || 'Draft');
          setRowVal(['Severity', 'ความรุนแรง'], data.severity || 'Normal');
          setRowVal(['Category', 'หมวดหมู่'], data.category || 'General');
          setRowVal(['Sub Category', 'หมวดหมู่ย่อย'], data.subCategory || '-');
          setRowVal(['Short Description & Subject', 'Subject', 'หัวข้อ'], data.subject);
          setRowVal(['Detail', 'รายละเอียด'], data.detail);
          setRowVal(['Created Date', 'Created'], today);
          setRowVal(['Remark', 'หมายเหตุ'], `Thread ID: ${data.threadId}`);

          let targetRow = -1;
          if (insertRowIndex > -1) {
            sheet.getRange(insertRowIndex, 1, 1, newRow.length).setValues([newRow]);
            targetRow = insertRowIndex;
          } else {
            sheet.appendRow(newRow);
            targetRow = sheet.getLastRow();
          }

          const dateCol = _findColIndex(headers, ['Date', 'วันที่แจ้ง']);
          if (dateCol > -1) _setCellFormat(sheet, targetRow, dateCol, 'dd/MM/yyyy');
          const createdCol = _findColIndex(headers, ['Created Date', 'Created']);
          if (createdCol > -1) _setCellFormat(sheet, targetRow, createdCol, 'dd/MM/yyyy HH:mm:ss');

          _clearTicketCache();
          return { success: true, id: data.id };
        } else {
          return { success: false, message: 'System Busy' };
        }
      } catch (e) {
        return { success: false, message: e.message };
      } finally {
        lock.releaseLock();
      }
    },

    /**
     * นำเข้า Ticket แบบ Batch (หลายรายการพร้อมกัน เขียน Sheet ครั้งเดียว)
     * @param {Object[]} dataArray
     */
    importBatchTickets: function (dataArray) {
      if (!dataArray || !Array.isArray(dataArray)) {
        return { success: false, message: 'importBatchTickets: dataArray must be an array' };
      }
      if (dataArray.length === 0) return { success: true, count: 0 };

      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(15000)) {
          const sheet = _getTicketSheet();
          const rawData = sheet.getDataRange().getValues();
          const headers = rawData[0];

          const idCol = _findColIndex(headers, ['Ticket Number', 'ID']);
          const dateCol = _findColIndex(headers, ['Date', 'วันที่แจ้ง']);
          const createdCol = _findColIndex(headers, ['Created Date', 'Created']);

          let existingIds = [];
          if (idCol > -1 && rawData.length > 1) {
            existingIds = rawData.slice(1).map(row => String(row[idCol]).trim().toUpperCase());
          }

          const newRows = [];
          const today = new Date();
          let currentTotalRows = rawData.length;
          let addedCount = 0;

          dataArray.forEach(data => {
            const ticketId = String(data.id).trim().toUpperCase();
            if (existingIds.includes(ticketId)) return;

            let newRow = new Array(headers.length).fill('');
            const setRowVal = (keys, val) => {
              const idx = _findColIndex(headers, keys);
              if (idx > -1) newRow[idx] = val;
            };

            let importDate = today;
            if (data.date) importDate = new Date(`${data.date}T${data.time || '00:00'}:00`);

            setRowVal(['No.', 'ลำดับ'], currentTotalRows + newRows.length);
            setRowVal(['Date', 'วันที่แจ้ง'], importDate);
            setRowVal(['Ticket Number', 'ID'], data.id);
            setRowVal(['Ticket Type', 'Type'], data.type || 'Request');
            setRowVal(['Ticket Status', 'Status'], data.status || 'Draft');
            setRowVal(['Severity', 'ความรุนแรง'], data.severity || 'Normal');
            setRowVal(['Category', 'หมวดหมู่'], data.category || 'General');
            setRowVal(['Sub Category', 'หมวดหมู่ย่อย'], data.subCategory || '-');
            setRowVal(['Short Description & Subject', 'Subject', 'หัวข้อ'], data.subject);
            setRowVal(['Detail', 'รายละเอียด'], data.detail);
            setRowVal(['Created Date', 'Created'], today);
            setRowVal(['Remark', 'หมายเหตุ'], `Thread ID: ${data.threadId}`);

            newRows.push(newRow);
            existingIds.push(ticketId); // ป้องกันซ้ำกันใน Batch เดียวกัน
            addedCount++;
          });

          // เขียนลง Sheet รวดเดียว (เร็วกว่าทีละแถว 10-20x)
          if (newRows.length > 0) {
            const startRow = currentTotalRows + 1;
            sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
            if (dateCol > -1)
              sheet.getRange(startRow, dateCol + 1, newRows.length, 1).setNumberFormat('dd/MM/yyyy');
            if (createdCol > -1)
              sheet.getRange(startRow, createdCol + 1, newRows.length, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
            _clearTicketCache();
          }

          return { success: true, count: addedCount };
        } else {
          return { success: false, message: 'System Busy (Timeout)' };
        }
      } catch (e) {
        return { success: false, message: e.message };
      } finally {
        lock.releaseLock();
      }
    },

    /**
     * รวบรวม ID ทั้งหมดและ ThreadID Map สำหรับ GmailService ใช้ตรวจสอบซ้ำ
     * @returns {{ ids: string[], threadMap: Object }}
     */
    getTicketMappings: function () {
      try {
        const tabName = (typeof CONFIG !== 'undefined' && CONFIG.TICKET_TAB) ? CONFIG.TICKET_TAB : TABLE_NAME;
        const ticketIdConfig = typeof CONFIG !== 'undefined' ? CONFIG.TICKET_ID : '';

        let data = [];
        try {
          data = SheetService.getAll(tabName, 300, ticketIdConfig);
        } catch (e) {
          const sheet = _getTicketSheet();
          data = sheet.getDataRange().getValues();
        }

        const mappings = { ids: [], threadMap: {} };
        if (!data || data.length < 2) return mappings;

        const headers = data[0];
        const idCol = _findColIndex(headers, ['Ticket Number', 'ID']);
        const remarkCol = _findColIndex(headers, ['Remark', 'หมายเหตุ']);
        if (idCol === -1) return mappings;

        for (let i = 1; i < data.length; i++) {
          const tid = String(data[i][idCol]).trim().toUpperCase();
          if (!tid) continue;
          mappings.ids.push(tid);
          if (remarkCol > -1) {
            const remark = String(data[i][remarkCol]);
            const match = remark.match(/\[Thread ID:\s*([a-zA-Z0-9]+)\]/);
            if (match && match[1]) mappings.threadMap[match[1]] = tid;
          }
        }
        return mappings;
      } catch (e) {
        console.warn('getTicketMappings Error', e);
        return { ids: [], threadMap: {} };
      }
    },
  };
})();
