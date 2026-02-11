/**
 * src/backend/controllers/TicketController.js
 * Version: Full Field Support & Logic Fixes
 */
const TicketController = (() => {
  const TABLE_NAME = "Ticket";

  function _getTicketSheet() {
    const ticketId = (typeof CONFIG !== 'undefined') ? CONFIG.TICKET_ID : "";
    if (!ticketId) throw new Error("Ticket ID Missing");
    const ss = SpreadsheetApp.openById(ticketId);
    let sheet = ss.getSheetByName(CONFIG.TICKET_TAB || TABLE_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.TICKET_TAB || TABLE_NAME);
      sheet.appendRow([
        "No.", "Date", "Ticket Number", "Ticket Type", "Ticket Status",
        "Severity", "Category", "Sub Category", "Short Description & Subject",
        "Detail", "Action", "Resolved detail", "Responsibility", "Assign", "Remark", "Created Date", "Resolved Date"
      ]);
    }
    // Auto-Add Headers
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    ["Created Date", "Resolved Date"].forEach(req => {
      const exists = headers.some(h => String(h).toLowerCase().trim() === req.toLowerCase().trim());
      if (!exists) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(req);
      }
    });
    return sheet;
  }

  // Helper to find column index (case-insensitive)
  function _findColIndex(headers, keys) {
    if (!Array.isArray(keys)) keys = [keys];
    return headers.findIndex(h => keys.some(k => String(h).toLowerCase().trim() === String(k).toLowerCase().trim()));
  }

  return {

    getTickets: function (forceRefresh) {
      try {
        const sheet = _getTicketSheet();
        const rawData = sheet.getDataRange().getValues();

        if (!rawData || rawData.length < 2) return Response.success([]);

        const headers = rawData[0];
        // Optimized helper
        const getIdx = (keys) => _findColIndex(headers, keys);

        const idx = {
          no: getIdx(["No.", "ลำดับ"]),
          date: getIdx(["Date", "วันที่แจ้ง", "วันที่"]),
          id: getIdx(["Ticket Number", "ID", "เลขที่ ticket"]),
          type: getIdx(["Ticket Type", "Type", "ประเภท"]),
          status: getIdx(["Ticket Status", "Status", "สถานะ"]),
          severity: getIdx(["Severity", "ความรุนแรง"]),
          cat: getIdx(["Category", "หมวดหมู่"]),
          subCat: getIdx(["Sub Category", "หมวดหมู่ย่อย"]),
          subject: getIdx(["Short Description & Subject", "Subject", "หัวข้อ"]),
          detail: getIdx(["Detail", "รายละเอียด"]),
          action: getIdx(["Action", "การดำเนินการ"]),
          resDetail: getIdx(["Resolved detail", "รายละเอียดการแก้ไข"]),
          resp: getIdx(["Responsibility", "ผู้รับผิดชอบ"]),
          assign: getIdx(["Assign", "มอบหมาย"]),
          remark: getIdx(["Remark", "หมายเหตุ"]),
          createdDate: getIdx(["Created Date", "Created", "วันที่สร้าง"]),
          resolvedDate: getIdx(["Resolved Date", "Closed Date", "วันที่ปิดงาน"]),
          duration: getIdx(["Duration"]),
          logUpdate: getIdx(["LOG UPDATE"])
        };

        const cleanData = rawData.slice(1).filter(row => {
          const tid = (idx.id > -1) ? row[idx.id] : null;
          return tid && String(tid).trim() !== "";
        }).map(row => {
          return [
            (idx.no > -1) ? row[idx.no] : "",
            (idx.date > -1) ? row[idx.date] : "",
            (idx.id > -1) ? String(row[idx.id]).trim() : "",
            (idx.type > -1) ? row[idx.type] : "",
            (idx.status > -1) ? row[idx.status] : "",
            (idx.severity > -1) ? row[idx.severity] : "Normal",
            (idx.cat > -1) ? row[idx.cat] : "-",
            (idx.subCat > -1) ? row[idx.subCat] : "-",
            (idx.subject > -1) ? row[idx.subject] : "-",
            (idx.detail > -1) ? row[idx.detail] : "-",
            (idx.action > -1) ? row[idx.action] : "-",
            (idx.resDetail > -1) ? row[idx.resDetail] : "-",
            (idx.resp > -1) ? row[idx.resp] : "-",
            (idx.assign > -1) ? row[idx.assign] : "-",
            (idx.remark > -1) ? row[idx.remark] : "-",
            (idx.createdDate > -1) ? row[idx.createdDate] : "",
            (idx.resolvedDate > -1) ? row[idx.resolvedDate] : "",
            (idx.duration > -1) ? row[idx.duration] : "",
            (idx.logUpdate > -1) ? row[idx.logUpdate] : ""
          ];
        });

        return Response.success(cleanData);
      } catch (e) { return Response.error("getTickets Failed: " + e.toString()); }
    },

    createTicket: function (form) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getTicketSheet();
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
          const today = new Date();

          // Gen ID
          const typePrefix = (form.type === 'Request') ? 'REQ' : 'INC';
          const datePart = Utilities.formatDate(today, tz, "yyMMdd");
          // e.g. INC-231025-
          const idPrefix = `${typePrefix}-${datePart}-`;

          const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
          let maxRun = 0;

          // Find max running number for today
          if (idCol > -1 && data.length > 1) {
            for (let i = 1; i < data.length; i++) {
              const id = String(data[i][idCol]);
              if (id.startsWith(idPrefix)) {
                const parts = id.split('-');
                // INC-231025-001 -> parts[2] is 001
                if (parts.length >= 3) {
                  const num = parseInt(parts[2], 10);
                  if (!isNaN(num) && num > maxRun) maxRun = num;
                }
              }
            }
          }
          // New ID
          const newId = `${idPrefix}${String(maxRun + 1).padStart(3, '0')}`;

          // Prepare Row
          const newRow = new Array(headers.length).fill("");

          const setRowVal = (keys, val) => {
            const idx = _findColIndex(headers, keys);
            if (idx > -1) newRow[idx] = val;
          };

          const nowStr = Utilities.formatDate(today, tz, "dd/MM/yyyy HH:mm:ss");
          const userDate = form.date ? `${form.date} ${form.time || ''}` : nowStr;

          // Mapping
          setRowVal(["No.", "ลำดับ"], data.length); // Row number (approx)
          setRowVal(["Ticket Number", "ID"], newId);
          setRowVal(["Ticket Type", "Type"], form.type || 'Incident');
          setRowVal(["Ticket Status", "Status"], "Open");
          setRowVal(["Severity"], form.severity || 'Normal');
          setRowVal(["Category"], form.category || '');
          setRowVal(["Sub Category"], form.subCategory || '');
          setRowVal(["Short Description & Subject", "Subject", "หัวข้อ"], form.subject || '');
          setRowVal(["Detail", "รายละเอียด"], form.detail || '');
          setRowVal(["Action", "การดำเนินการ"], form.action || '');
          setRowVal(["Resolved detail", "รายละเอียดการแก้ไข"], form.resolvedDetail || '');
          setRowVal(["Responsibility", "ผู้รับผิดชอบ"], form.responsibility || '');
          setRowVal(["Assign", "มอบหมาย"], form.assignee || '');
          setRowVal(["Remark", "หมายเหตุ"], form.remark || '');

          setRowVal(["Created Date", "Created"], nowStr);
          setRowVal(["Date", "วันที่แจ้ง"], userDate);

          sheet.appendRow(newRow);
          return Response.success({ message: "Created " + newId });
        } else {
          return Response.error("System busy, please try again.");
        }
      } catch (e) { return Response.error(e.toString()); } finally { lock.releaseLock(); }
    },

    updateTicket: function (form) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getTicketSheet();
          const data = sheet.getDataRange().getValues();
          const headers = data[0];

          const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
          if (idCol === -1) return Response.error("ID Column not found");

          const targetId = String(form.id).trim();
          let rowIdx = -1;
          for (let i = 1; i < data.length; i++) {
            if (String(data[i][idCol]).trim() === targetId) {
              rowIdx = i + 1;
              break;
            }
          }

          if (rowIdx === -1) return Response.error("Ticket Not Found: " + targetId);

          const setVal = (keys, val) => {
            const col = _findColIndex(headers, keys);
            if (col > -1) sheet.getRange(rowIdx, col + 1).setValue(val);
          };

          const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
          const nowStr = Utilities.formatDate(new Date(), tz, "dd/MM/yyyy HH:mm:ss");

          // Update Fields if they exist in form
          // Note: form contains all fields from modal, so we update them all to be safe
          // checking 'undefined' allows empty string updates (clearing values)

          if (form.type !== undefined) setVal(["Ticket Type", "Type"], form.type);
          if (form.status !== undefined) setVal(["Ticket Status", "Status"], form.status);
          if (form.severity !== undefined) setVal(["Severity"], form.severity);
          if (form.category !== undefined) setVal(["Category"], form.category);
          if (form.subCategory !== undefined) setVal(["Sub Category"], form.subCategory);
          // Subject (Important!)
          if (form.subject !== undefined) setVal(["Short Description & Subject", "Subject", "หัวข้อ"], form.subject);
          if (form.detail !== undefined) setVal(["Detail", "รายละเอียด"], form.detail);
          if (form.action !== undefined) setVal(["Action", "การดำเนินการ"], form.action);
          if (form.resolvedDetail !== undefined) setVal(["Resolved detail"], form.resolvedDetail);
          if (form.responsibility !== undefined) setVal(["Responsibility"], form.responsibility);
          if (form.assignee !== undefined) setVal(["Assign"], form.assignee);
          if (form.remark !== undefined) setVal(["Remark"], form.remark);

          // Date/Time update (Optional)
          if (form.date) {
            const userDate = `${form.date} ${form.time || ''}`;
            setVal(["Date", "วันที่แจ้ง"], userDate);
          }

          // Auto Resolved Date Logic
          if (form.status) {
            const s = String(form.status).toUpperCase();
            if (s.includes("RESOLVED") || s.includes("CLOSE") || s.includes("FIX")) {
              // Only set if not already set? Or update? Usually update is better to reflect actual finish time.
              setVal(["Resolved Date"], nowStr);
            } else if (s.includes("OPEN") || s.includes("PENDING")) {
              // If reopened, maybe clear resolved date? Or keep history?
              // User requirement: "Verified" or "Closed" means done.
              // If back to Open, usually we allow clearing or just leave it. 
              // Let's leave it for now unless requested.
            }
          }

          return Response.success({ message: "Updated " + targetId });
        }
      } catch (e) { return Response.error(e.toString()); } finally { lock.releaseLock(); }
    },

    deleteTicket: function (id) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(5000)) {
          const sheet = _getTicketSheet();
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);

          if (idCol === -1) return Response.error("Cannot find Ticket Number column");

          const targetId = String(id).trim();
          let rowIdx = -1;

          // Search from bottom to top
          for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][idCol]).trim() === targetId) {
              rowIdx = i + 1;
              break;
            }
          }

          if (rowIdx === -1) return Response.error("Ticket not found: " + targetId);

          sheet.deleteRow(rowIdx);
          return Response.success({ message: "Deleted " + targetId });
        }
      } catch (e) { return Response.error("Delete failed: " + e.toString()); } finally { lock.releaseLock(); }
    },
    getTicketConfig: () => Response.success({})
  };
})();