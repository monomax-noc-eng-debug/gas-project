/**
 * src/backend/controllers/TicketController.js
 * Version: Raw Data Export for API Processing
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
      if (!headers.some(h => String(h).toLowerCase().trim() === req.toLowerCase().trim())) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(req);
      }
    });
    return sheet;
  }

  return {
    getTickets: function (forceRefresh) {
      try {
        const sheet = _getTicketSheet();
        // ดึงข้อมูลแบบ Display Values เพื่อให้ได้ String เหมือนที่ตาเห็นใน Sheet (เช่น "10/02/2026 06:04:01")
        const rawData = sheet.getDataRange().getDisplayValues();
        
        if (!rawData || rawData.length < 2) return Response.success([]);

        const headers = rawData[0];
        const getIdx = (keys) => headers.findIndex(h => keys.some(k => String(h).toLowerCase().trim() === String(k).toLowerCase().trim()));

        const idx = {
          no: getIdx(["No."]),
          date: getIdx(["Date"]),
          id: getIdx(["Ticket Number", "ID"]),
          type: getIdx(["Ticket Type"]),
          status: getIdx(["Ticket Status", "Status"]),
          severity: getIdx(["Severity"]),
          cat: getIdx(["Category"]),
          subCat: getIdx(["Sub Category"]),
          subject: getIdx(["Short Description & Subject", "Subject"]),
          detail: getIdx(["Detail"]),
          action: getIdx(["Action"]),
          resDetail: getIdx(["Resolved detail"]),
          resp: getIdx(["Responsibility"]),
          assign: getIdx(["Assign"]),
          remark: getIdx(["Remark"]),
          createdDate: getIdx(["Created Date", "Created"]),
          resolvedDate: getIdx(["Resolved Date", "Closed Date"])
        };

        const cleanData = rawData.slice(1).filter(row => {
          const tid = (idx.id > -1) ? row[idx.id] : null;
          return tid && String(tid).trim() !== "";
        }).map(row => {
          // ส่งค่าเดิมๆ ออกไปเลย ไม่ต้องแปลง Date Object ที่นี่
          return [
            (idx.no > -1) ? row[idx.no] : "",
            (idx.date > -1) ? row[idx.date] : "",
            (idx.id > -1) ? String(row[idx.id]).trim() : "",
            (idx.type > -1) ? row[idx.type] : "Incident",
            (idx.status > -1) ? row[idx.status] : "Open",
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
            (idx.createdDate > -1) ? row[idx.createdDate] : "", // Index 15
            (idx.resolvedDate > -1) ? row[idx.resolvedDate] : "" // Index 16
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
                const idPrefix = `${typePrefix}-${datePart}-`;
                
                const idCol = headers.findIndex(h => h.includes("Ticket Number") || h === "ID");
                let maxRun = 0;
                if(idCol > -1) {
                    for (let i = 1; i < data.length; i++) {
                        const id = String(data[i][idCol]);
                        if (id.startsWith(idPrefix)) {
                            const parts = id.split('-');
                            const num = parseInt(parts[2], 10);
                            if (!isNaN(num) && num > maxRun) maxRun = num;
                        }
                    }
                }
                const newId = `${idPrefix}${String(maxRun + 1).padStart(3, '0')}`;

                const newRow = new Array(headers.length).fill("");
                const setVal = (key, val) => {
                    const i = headers.findIndex(h => String(h).toLowerCase().trim() === String(key).toLowerCase().trim());
                    if(i > -1) newRow[i] = val;
                };
                
                const nowStr = Utilities.formatDate(today, tz, "dd/MM/yyyy HH:mm:ss"); // Save as String Format

                setVal("No.", data.length);
                setVal("Ticket Number", newId);
                setVal("Ticket Type", form.type || 'Incident');
                setVal("Ticket Status", "Open");
                setVal("Created Date", nowStr); // Save formatted string
                setVal("Date", form.date ? `${form.date} ${form.time||''}` : nowStr);
                setVal("Detail", form.detail || "");

                sheet.appendRow(newRow);
                return Response.success({ message: "Created " + newId });
            }
        } catch(e) { return Response.error(e.toString()); } finally { lock.releaseLock(); }
    },

    updateTicket: function (form) {
        try {
            const sheet = _getTicketSheet();
            const data = sheet.getDataRange().getValues();
            const headers = data[0];
            const idCol = headers.findIndex(h => h.includes("Ticket Number"));
            let rowIdx = -1;
            for(let i=1; i<data.length; i++) { if(String(data[i][idCol]) === String(form.id)) { rowIdx = i+1; break; } }
            
            if(rowIdx === -1) return Response.error("Not Found");
            
            const setVal = (key, val) => {
                const col = headers.findIndex(h => String(h).toLowerCase().trim() === String(key).toLowerCase().trim());
                if(col > -1) sheet.getRange(rowIdx, col+1).setValue(val);
            };
            
            const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
            
            if(form.status) setVal("Ticket Status", form.status);
            if(form.detail) setVal("Detail", form.detail);
            
            // Auto Resolved Date
            const s = String(form.status).toUpperCase();
            if(s.includes("RESOLVED") || s.includes("CLOSED")) {
                setVal("Resolved Date", Utilities.formatDate(new Date(), tz, "dd/MM/yyyy HH:mm:ss"));
            }
            
            return Response.success({ message: "Updated" });
        } catch(e) { return Response.error(e.toString()); }
    },
    
    deleteTicket: (id) => Response.success({}),
    getTicketConfig: () => Response.success({})
  };
})();