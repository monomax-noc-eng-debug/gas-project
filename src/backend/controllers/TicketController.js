/**
 * src/backend/controllers/TicketController.js
 * Version: High Performance + Smart Insert (Preserve Formulas) + Temp ID Enforced
 */
const TicketController = (() => {
  const TABLE_NAME = "Ticket";

  function _getTicketSheet() {
    const ticketId = typeof CONFIG !== "undefined" ? CONFIG.TICKET_ID : "";
    if (!ticketId) throw new Error("Ticket ID Missing");
    const ss = SpreadsheetApp.openById(ticketId);
    let sheet = ss.getSheetByName(CONFIG.TICKET_TAB || TABLE_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.TICKET_TAB || TABLE_NAME);
      sheet.appendRow([
        "No.",
        "Date",
        "Ticket Number",
        "Ticket Type",
        "Ticket Status",
        "Severity",
        "Category",
        "Sub Category",
        "Short Description & Subject",
        "Detail",
        "Action",
        "Resolved detail",
        "Responsibility",
        "Assign",
        "Remark",
        "Created Date",
        "Resolved Date",
      ]);
    }
    // Auto-Add Headers
    const headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0];
    ["Created Date", "Resolved Date"].forEach((req) => {
      const exists = headers.some(
        (h) => String(h).toLowerCase().trim() === req.toLowerCase().trim(),
      );
      if (!exists) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(req);
      }
    });
    return sheet;
  }

  // Helper: Find Column Index
  function _findColIndex(headers, keys) {
    if (!Array.isArray(keys)) keys = [keys];
    return headers.findIndex((h) =>
      keys.some(
        (k) =>
          String(h).toLowerCase().trim() === String(k).toLowerCase().trim(),
      ),
    );
  }

  // ✅ Helper: ตั้งค่า Format วันที่ให้กับ Cell
  function _setCellFormat(sheet, row, colIndex, format) {
    if (row > 0 && colIndex > -1) {
      sheet.getRange(row, colIndex + 1).setNumberFormat(format);
    }
  }

  return {
    getTickets: function (forceRefresh) {
      try {
        const tabName =
          typeof CONFIG !== "undefined" && CONFIG.TICKET_TAB
            ? CONFIG.TICKET_TAB
            : TABLE_NAME;
        const ticketId = typeof CONFIG !== "undefined" ? CONFIG.TICKET_ID : "";
        const rawData = SheetService.getAll(
          tabName,
          1200,
          ticketId,
          forceRefresh,
        );

        if (!rawData || rawData.length < 2) return Response.success([]);

        const headers = rawData[0];
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
          resolvedDate: getIdx([
            "Resolved Date",
            "Closed Date",
            "วันที่ปิดงาน",
          ]),
          duration: getIdx(["Duration"]),
          logUpdate: getIdx(["LOG UPDATE"]),
        };

        const tz = typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
        const fmtDate = (val) => {
          if (!val || !(val instanceof Date)) return val;
          return Utilities.formatDate(val, tz, "yyyy-MM-dd");
        };
        const fmtTime = (val) => {
          if (!val || !(val instanceof Date)) return "";
          return Utilities.formatDate(val, tz, "HH:mm");
        };

        const cleanData = rawData
          .slice(1)
          .filter((row) => {
            const tid = idx.id > -1 ? row[idx.id] : null;
            return tid && String(tid).trim() !== "";
          })
          .map((row) => {
            return {
              no: idx.no > -1 ? row[idx.no] : "",
              date: idx.date > -1 ? fmtDate(row[idx.date]) : "",
              time: idx.date > -1 ? fmtTime(row[idx.date]) : "",
              ticketNumber: idx.id > -1 ? String(row[idx.id]).trim() : "",
              type: idx.type > -1 ? row[idx.type] : "",
              status: idx.status > -1 ? row[idx.status] : "",
              severity: idx.severity > -1 ? row[idx.severity] : "Normal",
              category: idx.cat > -1 ? row[idx.cat] : "-",
              subCategory: idx.subCat > -1 ? row[idx.subCat] : "-",
              subject: idx.subject > -1 ? row[idx.subject] : "-",
              detail: idx.detail > -1 ? row[idx.detail] : "-",
              action: idx.action > -1 ? row[idx.action] : "-",
              resolvedDetail: idx.resDetail > -1 ? row[idx.resDetail] : "-",
              responsibility: idx.resp > -1 ? row[idx.resp] : "-",
              assign: idx.assign > -1 ? row[idx.assign] : "-",
              remark: idx.remark > -1 ? row[idx.remark] : "-",
              createdDate: idx.createdDate > -1 ? fmtDate(row[idx.createdDate]) : "",
              resolvedDate: idx.resolvedDate > -1 ? fmtDate(row[idx.resolvedDate]) : "",
              duration: idx.duration > -1 ? row[idx.duration] : "",
              logUpdate: idx.logUpdate > -1 ? row[idx.logUpdate] : "",
            };
          });

        return Response.success(cleanData);
      } catch (e) {
        return Response.error("getTickets Failed: " + e.toString());
      }
    },

    createTicket: function (form) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getTicketSheet();
          const rawData = sheet.getDataRange().getValues();
          const headers = rawData[0];
          const tz =
            typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
          const today = new Date();

          const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
          const noCol = _findColIndex(headers, ["No.", "ลำดับ"]);
          // 🚀 เช็คช่องว่างจาก "หัวข้อ" เพื่อรักษาสูตร/Dropdown
          const checkCol = _findColIndex(headers, [
            "Short Description & Subject",
            "Subject",
            "หัวข้อ",
          ]);

          let newId = form.id ? String(form.id).trim() : "";

          if (newId && idCol > -1 && rawData.length > 1) {
            const ids = rawData
              .slice(1)
              .map((row) => String(row[idCol]).trim());
            if (ids.includes(newId)) {
              return Response.error(
                `Error: Ticket ID "${newId}" มีอยู่แล้วในระบบ!`,
              );
            }
          }

          let insertRowIndex = -1;
          let existingNo = null;

          if (checkCol > -1) {
            const emptyIdx = rawData.findIndex(
              (row, i) => i > 0 && String(row[checkCol]).trim() === "",
            );
            if (emptyIdx !== -1) {
              insertRowIndex = emptyIdx + 1;
              if (noCol > -1) existingNo = rawData[emptyIdx][noCol];
            }
          }

          // 🚀 ก๊อปปี้แถวเดิมเพื่อรักษาสูตรและ Dropdown
          let newRow = [];
          if (insertRowIndex > -1) {
            newRow = [...rawData[insertRowIndex - 1]];
          } else {
            newRow = new Array(headers.length).fill("");
          }

          const setRowVal = (keys, val) => {
            const idx = _findColIndex(headers, keys);
            if (idx > -1) newRow[idx] = val;
          };

          // 🚀 บังคับสร้าง Temp ID (INC/REQ) เสมอ แม้จะมี SVR รออยู่ก็ตาม
          if (!newId) {
            const typePrefix = form.type === "Request" ? "REQ" : "INC";
            const datePart = Utilities.formatDate(today, tz, "yyMMdd");
            const idPrefix = `${typePrefix}-${datePart}-`;
            let maxRun = 0;
            if (idCol > -1 && rawData.length > 1) {
              for (let i = 1; i < rawData.length; i++) {
                const id = String(rawData[i][idCol]);
                if (id.startsWith(idPrefix)) {
                  const parts = id.split("-");
                  if (parts.length >= 3) {
                    const num = parseInt(parts[2], 10);
                    if (!isNaN(num) && num > maxRun) maxRun = num;
                  }
                }
              }
            }
            newId = `${idPrefix}${String(maxRun + 1).padStart(3, "0")}`;
          }

          let userDate = today;
          if (form.date) {
            const t = form.time || "00:00";
            userDate = new Date(`${form.date}T${t}:00`);
          }

          if (!(insertRowIndex > -1 && existingNo)) {
            setRowVal(["No.", "ลำดับ"], rawData.length);
          }

          setRowVal(["Ticket Number", "ID"], newId); // เขียนทับ SVR เดิมไปเลย
          setRowVal(["Ticket Type", "Type"], form.type || "Incident");
          setRowVal(["Ticket Status", "Status"], "Open");
          setRowVal(["Severity"], form.severity || "Normal");
          setRowVal(["Category"], form.category || "");
          setRowVal(["Sub Category"], form.subCategory || "");
          setRowVal(
            ["Short Description & Subject", "Subject", "หัวข้อ"],
            form.subject || "",
          );
          setRowVal(["Detail", "รายละเอียด"], form.detail || "");
          setRowVal(["Action", "การดำเนินการ"], form.action || "");
          setRowVal(
            ["Resolved detail", "รายละเอียดการแก้ไข"],
            form.resolvedDetail || "",
          );
          setRowVal(
            ["Responsibility", "ผู้รับผิดชอบ"],
            form.responsibility || "",
          );
          setRowVal(["Assign", "มอบหมาย"], form.assignee || "");
          setRowVal(["Remark", "หมายเหตุ"], form.remark || "");
          setRowVal(["Created Date", "Created"], today);
          setRowVal(["Date", "วันที่แจ้ง"], userDate);

          let targetRow = -1;
          if (insertRowIndex > -1) {
            sheet
              .getRange(insertRowIndex, 1, 1, newRow.length)
              .setValues([newRow]);
            targetRow = insertRowIndex;
          } else {
            sheet.appendRow(newRow);
            targetRow = sheet.getLastRow();
          }

          const dateCol = _findColIndex(headers, ["Date", "วันที่แจ้ง"]);
          if (dateCol > -1)
            _setCellFormat(sheet, targetRow, dateCol, "dd/MM/yyyy");

          const createdCol = _findColIndex(headers, [
            "Created Date",
            "Created",
          ]);
          if (createdCol > -1)
            _setCellFormat(sheet, targetRow, createdCol, "dd/MM/yyyy HH:mm:ss");

          const ticketIdConfig =
            typeof CONFIG !== "undefined" ? CONFIG.TICKET_ID : "";
          const tabName =
            typeof CONFIG !== "undefined" && CONFIG.TICKET_TAB
              ? CONFIG.TICKET_TAB
              : TABLE_NAME;
          CacheService.getScriptCache().remove(
            `SHEET_DATA_${ticketIdConfig}_${tabName}`,
          );

          return Response.success({ message: "Created " + newId, id: newId });
        } else {
          return Response.error("System busy, please try again.");
        }
      } catch (e) {
        return Response.error(e.toString());
      } finally {
        lock.releaseLock();
      }
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

          // 🚀 ค้นหาแบบ Bottom-Up (ก้นชีตย้อนขึ้น) เร็วขึ้น 90%
          for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][idCol]).trim() === targetId) {
              rowIdx = i + 1;
              break;
            }
          }

          if (rowIdx === -1)
            return Response.error("Ticket Not Found: " + targetId);

          const setVal = (keys, val) => {
            const col = _findColIndex(headers, keys);
            if (col > -1) sheet.getRange(rowIdx, col + 1).setValue(val);
            return col;
          };

          const today = new Date();

          if (form.type !== undefined)
            setVal(["Ticket Type", "Type"], form.type);
          if (form.status !== undefined)
            setVal(["Ticket Status", "Status"], form.status);
          if (form.severity !== undefined) setVal(["Severity"], form.severity);
          if (form.category !== undefined) setVal(["Category"], form.category);
          if (form.subCategory !== undefined)
            setVal(["Sub Category"], form.subCategory);
          if (form.subject !== undefined)
            setVal(
              ["Short Description & Subject", "Subject", "หัวข้อ"],
              form.subject,
            );
          if (form.detail !== undefined)
            setVal(["Detail", "รายละเอียด"], form.detail);
          if (form.action !== undefined)
            setVal(["Action", "การดำเนินการ"], form.action);
          if (form.resolvedDetail !== undefined)
            setVal(["Resolved detail", "รายละเอียดการแก้ไข"], form.resolvedDetail);
          if (form.responsibility !== undefined)
            setVal(["Responsibility", "ผู้รับผิดชอบ"], form.responsibility);
          if (form.assignee !== undefined) setVal(["Assign", "มอบหมาย"], form.assignee);
          if (form.remark !== undefined) setVal(["Remark", "หมายเหตุ"], form.remark);

          if (form.date) {
            const t = form.time || "00:00";
            const d = new Date(`${form.date}T${t}:00`);
            const col = setVal(["Date", "วันที่แจ้ง"], d);
            _setCellFormat(sheet, rowIdx, col, "dd/MM/yyyy");
          }

          if (form.status) {
            const s = String(form.status).toUpperCase();
            if (
              s.includes("RESOLVED") ||
              s.includes("CLOSE") ||
              s.includes("FIX")
            ) {
              const col = setVal(["Resolved Date", "Closed Date"], today);
              _setCellFormat(sheet, rowIdx, col, "dd/MM/yyyy HH:mm:ss");
            } else {
              setVal(["Resolved Date", "Closed Date"], "");
            }
          }

          const ticketIdConfig =
            typeof CONFIG !== "undefined" ? CONFIG.TICKET_ID : "";
          const tabName =
            typeof CONFIG !== "undefined" && CONFIG.TICKET_TAB
              ? CONFIG.TICKET_TAB
              : TABLE_NAME;
          CacheService.getScriptCache().remove(
            `SHEET_DATA_${ticketIdConfig}_${tabName}`,
          );

          return Response.success({ message: "Updated " + targetId });
        }
      } catch (e) {
        return Response.error(e.toString());
      } finally {
        lock.releaseLock();
      }
    },

    deleteTicket: function (id) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(5000)) {
          const sheet = _getTicketSheet();
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);

          if (idCol === -1)
            return Response.error("Cannot find Ticket Number column");

          const targetId = String(id).trim();
          let rowIdx = -1;

          for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][idCol]).trim() === targetId) {
              rowIdx = i + 1;
              break;
            }
          }

          if (rowIdx === -1)
            return Response.error("Ticket not found: " + targetId);

          sheet.deleteRow(rowIdx);

          const ticketIdConfig =
            typeof CONFIG !== "undefined" ? CONFIG.TICKET_ID : "";
          const tabName =
            typeof CONFIG !== "undefined" && CONFIG.TICKET_TAB
              ? CONFIG.TICKET_TAB
              : TABLE_NAME;
          CacheService.getScriptCache().remove(
            `SHEET_DATA_${ticketIdConfig}_${tabName}`,
          );

          return Response.success({ message: "Deleted " + targetId });
        }
      } catch (e) {
        return Response.error("Delete failed: " + e.toString());
      } finally {
        lock.releaseLock();
      }
    },



    importTicket: function (data) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getTicketSheet();
          const rawData = sheet.getDataRange().getValues();
          const headers = rawData[0];

          const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
          const noCol = _findColIndex(headers, ["No.", "ลำดับ"]);
          const checkCol = _findColIndex(headers, [
            "Short Description & Subject",
            "Subject",
            "หัวข้อ",
          ]);

          if (idCol > -1 && rawData.length > 1) {
            const ids = rawData
              .slice(1)
              .map((row) => String(row[idCol]).trim());
            if (ids.includes(data.id))
              return { success: false, message: "Duplicate ID" };
          }

          let insertRowIndex = -1;
          let existingNo = null;

          if (checkCol > -1) {
            const emptyIdx = rawData.findIndex(
              (row, i) => i > 0 && String(row[checkCol]).trim() === "",
            );
            if (emptyIdx !== -1) {
              insertRowIndex = emptyIdx + 1;
              if (noCol > -1) existingNo = rawData[emptyIdx][noCol];
            }
          }

          let newRow = [];
          if (insertRowIndex > -1) {
            newRow = [...rawData[insertRowIndex - 1]];
          } else {
            newRow = new Array(headers.length).fill("");
          }

          const setRowVal = (keys, val) => {
            const idx = _findColIndex(headers, keys);
            if (idx > -1) newRow[idx] = val;
          };

          const today = new Date();
          let importDate = today;
          if (data.date) {
            const t = data.time || "00:00";
            importDate = new Date(`${data.date}T${t}:00`);
          }

          if (!(insertRowIndex > -1 && existingNo)) {
            setRowVal(["No.", "ลำดับ"], rawData.length);
          }

          setRowVal(["Date", "วันที่แจ้ง"], importDate);
          setRowVal(["Ticket Number", "ID"], data.id);
          setRowVal(["Ticket Type", "Type"], data.type || "Request");
          setRowVal(["Ticket Status", "Status"], data.status || "Draft");
          setRowVal(["Severity", "ความรุนแรง"], data.severity || "Normal");
          setRowVal(["Category", "หมวดหมู่"], data.category || "General");
          setRowVal(["Sub Category", "หมวดหมู่ย่อย"], data.subCategory || "-");
          setRowVal(
            ["Short Description & Subject", "Subject", "หัวข้อ"],
            data.subject,
          );
          setRowVal(["Detail", "รายละเอียด"], data.detail);
          setRowVal(["Created Date", "Created"], today);
          setRowVal(["Remark", "หมายเหตุ"], `Thread ID: ${data.threadId}`);

          let targetRow = -1;
          if (insertRowIndex > -1) {
            sheet
              .getRange(insertRowIndex, 1, 1, newRow.length)
              .setValues([newRow]);
            targetRow = insertRowIndex;
          } else {
            sheet.appendRow(newRow);
            targetRow = sheet.getLastRow();
          }

          const dateCol = _findColIndex(headers, ["Date", "วันที่แจ้ง"]);
          if (dateCol > -1)
            _setCellFormat(sheet, targetRow, dateCol, "dd/MM/yyyy");
          const createdCol = _findColIndex(headers, [
            "Created Date",
            "Created",
          ]);
          if (createdCol > -1)
            _setCellFormat(sheet, targetRow, createdCol, "dd/MM/yyyy HH:mm:ss");

          const ticketIdConfig =
            typeof CONFIG !== "undefined" ? CONFIG.TICKET_ID : "";
          const tabName =
            typeof CONFIG !== "undefined" && CONFIG.TICKET_TAB
              ? CONFIG.TICKET_TAB
              : TABLE_NAME;
          CacheService.getScriptCache().remove(
            `SHEET_DATA_${ticketIdConfig}_${tabName}`,
          );

          return { success: true, id: data.id };
        } else {
          return { success: false, message: "System Busy" };
        }
      } catch (e) {
        return { success: false, message: e.message };
      } finally {
        lock.releaseLock();
      }
    },

    createTicketAndDraft: function (payload) {
      const { ticket, email } = payload;
      let ticketId = ticket.id ? String(ticket.id).trim().toUpperCase() : null;
      let existingThreadId = null;
      let isUpdate = false;

      let draft;
      let draftId = "";
      let threadId = "";

      try {
        // 🚀 STEP 1: อ่านข้อมูล Sheet แค่รอบเดียวเพื่อเช็คว่าเป็นงานใหม่หรือเก่า และดึง Thread ID เดิม
        const sheet = _getTicketSheet();
        const data = sheet.getDataRange().getValues();
        const headers = data[0];
        const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
        const remarkCol = _findColIndex(headers, ["Remark", "หมายเหตุ"]);

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

        const recipient = (email.to || "").trim();

        // 🚀 STEP 2: ไปสร้าง Draft ใน Gmail ให้เสร็จก่อน (เพื่อเอา ID)
        if (recipient || existingThreadId) {
          if (existingThreadId) {
            try {
              const thread = GmailApp.getThreadById(existingThreadId);
              if (thread) {
                draft = thread.createDraftReplyAll("", {
                  htmlBody: email.bodyHtml || "",
                  cc: (email.cc || "").trim(),
                });
                threadId = existingThreadId;
              }
            } catch (e) {
              console.warn(
                "Cannot find existing thread, fallback to new email",
                e,
              );
            }
          }

          if (!draft) {
            draft = GmailApp.createDraft(
              recipient,
              email.subject || "(No Subject)",
              "",
              { htmlBody: email.bodyHtml || "", cc: (email.cc || "").trim() },
            );
            try {
              threadId = draft.getMessage().getThread().getId();
            } catch (e) { }
          }

          try {
            draftId = draft.getMessage().getId();
          } catch (err) {
            draftId = draft.getId();
          }
        }

        // 🚀 STEP 3: ถ้าได้ Thread ID ใหม่มา ให้จับยัดใส่ Remark เตรียมไว้เลย
        if (threadId && !existingThreadId) {
          const currentRemark = ticket.remark || "";
          if (!currentRemark.includes(threadId)) {
            ticket.remark = currentRemark
              ? `${currentRemark}\n[Thread ID: ${threadId}]`
              : `[Thread ID: ${threadId}]`;
          }
        }

        // 🚀 STEP 4: ทำการเซฟลง Sheet แค่รอบเดียว (1 DB Hit!) ประหยัดเวลาไปได้มหาศาล
        let resVal;
        if (isUpdate) {
          resVal = TicketController.updateTicket(ticket);
        } else {
          resVal = TicketController.createTicket(ticket);
        }

        let resObj = typeof resVal === "string" ? JSON.parse(resVal) : resVal;

        if (!resObj.success) {
          return {
            success: false,
            message: resObj.message || "Failed to save ticket",
            ticketId: ticketId,
          };
        }

        if (resObj.data && resObj.data.id) ticketId = resObj.data.id;

        return {
          success: true,
          message: draftId
            ? existingThreadId
              ? "Ticket saved & Draft Reply created"
              : "Ticket saved & New Draft created"
            : "Ticket saved (No Draft)",
          draftId: draftId,
          draftUrl: draftId
            ? `https://mail.google.com/mail/u/0/#drafts/${draftId}`
            : null,
          threadId: threadId,
          ticketId: ticketId,
        };
      } catch (e) {
        console.error("createTicketAndDraft Error", e);
        return {
          success: false,
          message: "System Error: " + e.message,
          ticketId: ticketId,
        };
      }
    },

    getThreadIdMap: function () {
      try {
        const sheet = _getTicketSheet();
        const data = sheet.getDataRange().getValues();
        if (data.length < 2) return {};
        const headers = data[0];
        const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
        const remarkCol = _findColIndex(headers, ["Remark", "หมายเหตุ"]);

        if (idCol === -1 || remarkCol === -1) return {};

        const map = {};
        for (let i = 1; i < data.length; i++) {
          const tid = String(data[i][idCol]).trim();
          const remark = String(data[i][remarkCol]);
          if (!tid) continue;

          const match = remark.match(/\[Thread ID:\s*([a-zA-Z0-9]+)\]/);
          if (match && match[1]) {
            map[match[1]] = tid;
          }
        }
        return map;
      } catch (e) {
        console.warn("getThreadIdMap Error", e);
        return {};
      }
    },

    // 🚀 เพิ่มฟังก์ชันใหม่ รวมการอ่าน Sheet รอบเดียวให้ GmailService ใช้
    getTicketMappings: function () {
      try {
        const tabName = typeof CONFIG !== "undefined" && CONFIG.TICKET_TAB ? CONFIG.TICKET_TAB : TABLE_NAME;
        const ticketIdConfig = typeof CONFIG !== "undefined" ? CONFIG.TICKET_ID : "";

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
        const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
        const remarkCol = _findColIndex(headers, ["Remark", "หมายเหตุ"]);

        if (idCol === -1) return mappings;

        for (let i = 1; i < data.length; i++) {
          const tid = String(data[i][idCol]).trim().toUpperCase();
          if (!tid) continue;
          mappings.ids.push(tid);

          if (remarkCol > -1) {
            const remark = String(data[i][remarkCol]);
            const match = remark.match(/\[Thread ID:\s*([a-zA-Z0-9]+)\]/);
            if (match && match[1]) {
              mappings.threadMap[match[1]] = tid;
            }
          }
        }
        return mappings;
      } catch (e) {
        console.warn("getTicketMappings Error", e);
        return { ids: [], threadMap: {} };
      }
    },

    updateTicketIdOnly: function (oldId, newSvrId) {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(10000)) {
        try {
          const sheet = _getTicketSheet();
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);

          if (idCol === -1)
            return { success: false, message: "ID Column not found" };

          const existingIds = data
            .slice(1)
            .map((r) => String(r[idCol]).trim().toUpperCase());
          if (existingIds.includes(String(newSvrId).trim().toUpperCase())) {
            return {
              success: false,
              message: `Duplicate: ID ${newSvrId} already exists.`,
            };
          }

          let rowIdx = -1;
          const target = String(oldId).trim();

          // 🚀 Bottom-Up Search
          for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][idCol]).trim() === target) {
              rowIdx = i + 1;
              break;
            }
          }

          if (rowIdx === -1)
            return { success: false, message: "Old ID Not Found: " + oldId };

          sheet.getRange(rowIdx, idCol + 1).setValue(newSvrId);

          const ticketIdConfig =
            typeof CONFIG !== "undefined" ? CONFIG.TICKET_ID : "";
          const tabName =
            typeof CONFIG !== "undefined" && CONFIG.TICKET_TAB
              ? CONFIG.TICKET_TAB
              : TABLE_NAME;
          CacheService.getScriptCache().remove(
            `SHEET_DATA_${ticketIdConfig}_${tabName}`,
          );

          return {
            success: true,
            message: `Updated ID ${oldId} -> ${newSvrId}`,
          };
        } catch (e) {
          return { success: false, message: e.message };
        } finally {
          lock.releaseLock();
        }
      }
      return { success: false, message: "System Busy" };
    },

    appendThreadIdToRemark: function (ticketId, threadId) {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(5000)) {
        try {
          const sheet = _getTicketSheet();
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
          const remarkCol = _findColIndex(headers, ["Remark", "หมายเหตุ"]);

          if (idCol === -1 || remarkCol === -1) return;

          // 🚀 Bottom-Up Search
          for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][idCol]).trim() === String(ticketId).trim()) {
              const currentRemark = String(data[i][remarkCol]);
              if (!currentRemark.includes(threadId)) {
                const newRemark = currentRemark
                  ? `${currentRemark}\n[Thread ID: ${threadId}]`
                  : `[Thread ID: ${threadId}]`;
                sheet.getRange(i + 1, remarkCol + 1).setValue(newRemark);

                const ticketIdConfig =
                  typeof CONFIG !== "undefined" ? CONFIG.TICKET_ID : "";
                const tabName =
                  typeof CONFIG !== "undefined" && CONFIG.TICKET_TAB
                    ? CONFIG.TICKET_TAB
                    : TABLE_NAME;
                CacheService.getScriptCache().remove(
                  `SHEET_DATA_${ticketIdConfig}_${tabName}`,
                );
              }
              break;
            }
          }
        } catch (e) {
          console.error("appendThreadIdToRemark Failed", e);
        } finally {
          lock.releaseLock();
        }
      }
    },

    getAllTicketIds: function () {
      const sheet = _getTicketSheet();
      const data = sheet.getDataRange().getValues();
      if (data.length < 2) return [];
      const headers = data[0];
      const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
      if (idCol === -1) return [];
      return data.slice(1).map((r) => String(r[idCol]).trim().toUpperCase());
    },

    getStats: function () {
      const sheet = _getTicketSheet();
      const lastRow = sheet.getLastRow();
      return { total: lastRow > 1 ? lastRow - 1 : 0 };
    },



    // ✨ [NEW] นำเข้าข้อมูลแบบรวดเดียว (Batch) เพื่อลดการเรียก Google Sheets API
    importBatchTickets: function (dataArray) {
      if (!dataArray || dataArray.length === 0)
        return { success: true, count: 0 };

      const lock = LockService.getScriptLock();
      try {
        // ให้เวลารอ Lock นานขึ้นนิดนึงสำหรับการทำ Batch
        if (lock.tryLock(15000)) {
          const sheet = _getTicketSheet();
          const rawData = sheet.getDataRange().getValues();
          const headers = rawData[0];

          const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
          const noCol = _findColIndex(headers, ["No.", "ลำดับ"]);
          const dateCol = _findColIndex(headers, ["Date", "วันที่แจ้ง"]);
          const createdCol = _findColIndex(headers, [
            "Created Date",
            "Created",
          ]);

          let existingIds = [];
          if (idCol > -1 && rawData.length > 1) {
            existingIds = rawData
              .slice(1)
              .map((row) => String(row[idCol]).trim().toUpperCase());
          }

          const newRows = [];
          const today = new Date();
          let currentTotalRows = rawData.length;
          let addedCount = 0;

          // 1. เตรียมข้อมูลทุกแถวไว้ใน Memory
          dataArray.forEach((data) => {
            const ticketId = String(data.id).trim().toUpperCase();

            // ข้ามถ้ารหัสซ้ำ
            if (existingIds.includes(ticketId)) return;

            let newRow = new Array(headers.length).fill("");
            const setRowVal = (keys, val) => {
              const idx = _findColIndex(headers, keys);
              if (idx > -1) newRow[idx] = val;
            };

            let importDate = today;
            if (data.date) {
              const t = data.time || "00:00";
              importDate = new Date(`${data.date}T${t}:00`);
            }

            setRowVal(["No.", "ลำดับ"], currentTotalRows + newRows.length);
            setRowVal(["Date", "วันที่แจ้ง"], importDate);
            setRowVal(["Ticket Number", "ID"], data.id);
            setRowVal(["Ticket Type", "Type"], data.type || "Request");
            setRowVal(["Ticket Status", "Status"], data.status || "Draft");
            setRowVal(["Severity", "ความรุนแรง"], data.severity || "Normal");
            setRowVal(["Category", "หมวดหมู่"], data.category || "General");
            setRowVal(
              ["Sub Category", "หมวดหมู่ย่อย"],
              data.subCategory || "-",
            );
            setRowVal(
              ["Short Description & Subject", "Subject", "หัวข้อ"],
              data.subject,
            );
            setRowVal(["Detail", "รายละเอียด"], data.detail);
            setRowVal(["Created Date", "Created"], today);
            setRowVal(["Remark", "หมายเหตุ"], `Thread ID: ${data.threadId}`);

            newRows.push(newRow);
            existingIds.push(ticketId); // ป้องกันข้อมูลซ้ำกันเองใน Batch
            addedCount++;
          });

          // 2. เขียนลง Sheet รวดเดียว! (เร็วกว่าเดิม 10-20 เท่า)
          if (newRows.length > 0) {
            const startRow = currentTotalRows + 1;
            sheet
              .getRange(startRow, 1, newRows.length, headers.length)
              .setValues(newRows);

            // Format วันที่ทีเดียว
            if (dateCol > -1) {
              sheet
                .getRange(startRow, dateCol + 1, newRows.length, 1)
                .setNumberFormat("dd/MM/yyyy");
            }
            if (createdCol > -1) {
              sheet
                .getRange(startRow, createdCol + 1, newRows.length, 1)
                .setNumberFormat("dd/MM/yyyy HH:mm:ss");
            }

            // เคลียร์ Cache
            const ticketIdConfig =
              typeof CONFIG !== "undefined" ? CONFIG.TICKET_ID : "";
            const tabName =
              typeof CONFIG !== "undefined" && CONFIG.TICKET_TAB
                ? CONFIG.TICKET_TAB
                : TABLE_NAME;
            CacheService.getScriptCache().remove(
              `SHEET_DATA_${ticketIdConfig}_${tabName}`,
            );
          }

          return { success: true, count: addedCount };
        } else {
          return { success: false, message: "System Busy (Timeout)" };
        }
      } catch (e) {
        return { success: false, message: e.message };
      } finally {
        lock.releaseLock();
      }
    },
  };
})();
