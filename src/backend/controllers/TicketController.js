/**
 * src/backend/controllers/TicketController.js
 * Version: Final (Smart Insert, Manual ID, Auto Subject, Date Object & Formatting)
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

  // Helper: Find Column Index
  function _findColIndex(headers, keys) {
    if (!Array.isArray(keys)) keys = [keys];
    return headers.findIndex(h => keys.some(k => String(h).toLowerCase().trim() === String(k).toLowerCase().trim()));
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
        const sheet = _getTicketSheet();
        const rawData = sheet.getDataRange().getValues();

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
          resolvedDate: getIdx(["Resolved Date", "Closed Date", "วันที่ปิดงาน"]),
          duration: getIdx(["Duration"]),
          logUpdate: getIdx(["LOG UPDATE"])
        };

        const cleanData = rawData.slice(1).filter(row => {
          const tid = (idx.id > -1) ? row[idx.id] : null;
          return tid && String(tid).trim() !== "";
        }).map(row => {
          return {
            no: (idx.no > -1) ? row[idx.no] : "",
            date: (idx.date > -1) ? row[idx.date] : "",
            ticketNumber: (idx.id > -1) ? String(row[idx.id]).trim() : "",
            type: (idx.type > -1) ? row[idx.type] : "",
            status: (idx.status > -1) ? row[idx.status] : "",
            severity: (idx.severity > -1) ? row[idx.severity] : "Normal",
            category: (idx.cat > -1) ? row[idx.cat] : "-",
            subCategory: (idx.subCat > -1) ? row[idx.subCat] : "-",
            subject: (idx.subject > -1) ? row[idx.subject] : "-",
            detail: (idx.detail > -1) ? row[idx.detail] : "-",
            action: (idx.action > -1) ? row[idx.action] : "-",
            resolvedDetail: (idx.resDetail > -1) ? row[idx.resDetail] : "-",
            responsibility: (idx.resp > -1) ? row[idx.resp] : "-",
            assign: (idx.assign > -1) ? row[idx.assign] : "-",
            remark: (idx.remark > -1) ? row[idx.remark] : "-",
            createdDate: (idx.createdDate > -1) ? row[idx.createdDate] : "",
            resolvedDate: (idx.resolvedDate > -1) ? row[idx.resolvedDate] : "",
            duration: (idx.duration > -1) ? row[idx.duration] : "",
            logUpdate: (idx.logUpdate > -1) ? row[idx.logUpdate] : ""
          };
        });

        return Response.success(cleanData);
      } catch (e) { return Response.error("getTickets Failed: " + e.toString()); }
    },

    // ✅ createTicket: Smart Insert + Manual ID + Date Object
    createTicket: function (form) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getTicketSheet();
          const rawData = sheet.getDataRange().getValues();
          const headers = rawData[0];
          const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
          const today = new Date();

          // 1. ตรวจสอบ ID & หาช่องว่าง
          const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
          const noCol = _findColIndex(headers, ["No.", "ลำดับ"]);

          let newId = form.id ? String(form.id).trim() : "";

          // เช็ค ID ซ้ำ
          if (newId && idCol > -1 && rawData.length > 1) {
            const ids = rawData.slice(1).map(row => String(row[idCol]).trim());
            if (ids.includes(newId)) {
              return Response.error(`Error: Ticket ID "${newId}" มีอยู่แล้วในระบบ!`);
            }
          }

          // 🔍 Logic หาช่องว่าง (Smart Insert)
          let insertRowIndex = -1;
          let existingNo = null;

          if (idCol > -1) {
            for (let i = 1; i < rawData.length; i++) {
              const cellVal = rawData[i][idCol];
              if (!cellVal || String(cellVal).trim() === "") {
                insertRowIndex = i + 1; // 1-based index
                if (noCol > -1) existingNo = rawData[i][noCol];
                break;
              }
            }
          }

          // Auto-Gen ID ถ้าไม่ได้ระบุ
          if (!newId) {
            const typePrefix = (form.type === 'Request') ? 'REQ' : 'INC';
            const datePart = Utilities.formatDate(today, tz, "yyMMdd");
            const idPrefix = `${typePrefix}-${datePart}-`;
            let maxRun = 0;
            if (idCol > -1 && rawData.length > 1) {
              for (let i = 1; i < rawData.length; i++) {
                const id = String(rawData[i][idCol]);
                if (id.startsWith(idPrefix)) {
                  const parts = id.split('-');
                  if (parts.length >= 3) {
                    const num = parseInt(parts[2], 10);
                    if (!isNaN(num) && num > maxRun) maxRun = num;
                  }
                }
              }
            }
            newId = `${idPrefix}${String(maxRun + 1).padStart(3, '0')}`;
          }

          // 2. เตรียมข้อมูล
          const newRow = new Array(headers.length).fill("");
          const setRowVal = (keys, val) => {
            const idx = _findColIndex(headers, keys);
            if (idx > -1) newRow[idx] = val;
          };

          // แปลงวันที่ Input เป็น Object
          let userDate = today;
          if (form.date) {
            const t = form.time || "00:00";
            userDate = new Date(`${form.date}T${t}:00`);
          }

          // จัดการเลข No.
          if (insertRowIndex > -1 && existingNo) {
            setRowVal(["No.", "ลำดับ"], existingNo);
          } else {
            setRowVal(["No.", "ลำดับ"], rawData.length);
          }

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
          setRowVal(["Created Date", "Created"], today);
          setRowVal(["Date", "วันที่แจ้ง"], userDate);

          // 3. บันทึกลง Sheet (Insert or Append)
          let targetRow = -1;
          if (insertRowIndex > -1) {
            sheet.getRange(insertRowIndex, 1, 1, newRow.length).setValues([newRow]);
            targetRow = insertRowIndex;
          } else {
            sheet.appendRow(newRow);
            targetRow = sheet.getLastRow();
          }

          // 4. Format Cell (โชว์ dd/MM/yyyy)
          const dateCol = _findColIndex(headers, ["Date", "วันที่แจ้ง"]);
          if (dateCol > -1) _setCellFormat(sheet, targetRow, dateCol, "dd/MM/yyyy");

          const createdCol = _findColIndex(headers, ["Created Date", "Created"]);
          if (createdCol > -1) _setCellFormat(sheet, targetRow, createdCol, "dd/MM/yyyy HH:mm:ss");

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
            return col;
          };

          const today = new Date();

          if (form.type !== undefined) setVal(["Ticket Type", "Type"], form.type);
          if (form.status !== undefined) setVal(["Ticket Status", "Status"], form.status);
          if (form.severity !== undefined) setVal(["Severity"], form.severity);
          if (form.category !== undefined) setVal(["Category"], form.category);
          if (form.subCategory !== undefined) setVal(["Sub Category"], form.subCategory);
          if (form.subject !== undefined) setVal(["Short Description & Subject", "Subject", "หัวข้อ"], form.subject);
          if (form.detail !== undefined) setVal(["Detail", "รายละเอียด"], form.detail);
          if (form.action !== undefined) setVal(["Action", "การดำเนินการ"], form.action);
          if (form.resolvedDetail !== undefined) setVal(["Resolved detail"], form.resolvedDetail);
          if (form.responsibility !== undefined) setVal(["Responsibility"], form.responsibility);
          if (form.assignee !== undefined) setVal(["Assign"], form.assignee);
          if (form.remark !== undefined) setVal(["Remark"], form.remark);

          // ✅ Update Date: Object + Format
          if (form.date) {
            const t = form.time || "00:00";
            const d = new Date(`${form.date}T${t}:00`);
            const col = setVal(["Date", "วันที่แจ้ง"], d);
            _setCellFormat(sheet, rowIdx, col, "dd/MM/yyyy");
          }

          if (form.status) {
            const s = String(form.status).toUpperCase();
            if (s.includes("RESOLVED") || s.includes("CLOSE") || s.includes("FIX")) {
              const col = setVal(["Resolved Date"], today);
              _setCellFormat(sheet, rowIdx, col, "dd/MM/yyyy HH:mm:ss");
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

    getTicketConfig: function () {
      try {
        if (typeof CONFIG === 'undefined' || !CONFIG.DB_ID) {
          return Response.error("System Config Error");
        }
        const TAB_NAME = "Setting_Ticket";
        const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
        let sheet = ss.getSheetByName(TAB_NAME);
        if (!sheet) {
          sheet = ss.insertSheet(TAB_NAME);
          sheet.appendRow(["Type", "Status", "Severity", "Category", "SubCategory"]);
          const defaults = [
            ["Incident", "Open", "Low", "Hardware", "Monitor"],
            ["Request", "Pending", "Medium", "Hardware", "Keyboard"],
            ["", "Resolved", "High", "Software", "Windows"],
            ["", "Closed", "Critical", "Software", "Office"],
            ["", "Cancelled", "Normal", "Network", "Internet"]
          ];
          defaults.forEach(r => sheet.appendRow(r));
        }
        const data = sheet.getDataRange().getValues();
        if (!data || data.length < 1) return Response.success({ types: [], statuses: [], severities: [], categories: {} });
        const headers = data[0];
        const idx = {
          type: _findColIndex(headers, ["Type", "Ticket Type", "ประเภท"]),
          status: _findColIndex(headers, ["Status", "Ticket Status", "สถานะ"]),
          severity: _findColIndex(headers, ["Severity", "Level", "ความรุนแรง"]),
          cat: _findColIndex(headers, ["Category", "Main Category", "หมวดหมู่"]),
          sub: _findColIndex(headers, ["SubCategory", "Sub Category", "Sub-Category", "หมวดหมู่ย่อย"])
        };
        const config = { types: [], statuses: [], severities: [], categories: {} };
        const addUnique = (arr, val) => {
          if (val && String(val).trim() !== "" && !arr.includes(val)) arr.push(String(val).trim());
        };
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (idx.type > -1) addUnique(config.types, row[idx.type]);
          if (idx.status > -1) addUnique(config.statuses, row[idx.status]);
          if (idx.severity > -1) addUnique(config.severities, row[idx.severity]);
          if (idx.cat > -1) {
            const cat = row[idx.cat];
            if (cat && String(cat).trim() !== "") {
              const catName = String(cat).trim();
              if (!config.categories[catName]) config.categories[catName] = [];
              if (idx.sub > -1) {
                const sub = row[idx.sub];
                if (sub && String(sub).trim() !== "") {
                  const subName = String(sub).trim();
                  if (!config.categories[catName].includes(subName)) {
                    config.categories[catName].push(subName);
                  }
                }
              }
            }
          }
        }
        // Merge Staff/Assignees from Setting_Staff
        try {
          const sheetStaff = SheetService.ensureSheet("Setting_Staff", ["Role", "Name"]);
          const dataStaff = sheetStaff.getDataRange().getValues();
          const leaders = [];
          const operators = [];
          if (dataStaff && dataStaff.length > 1) {
            for (let i = 1; i < dataStaff.length; i++) {
              const role = String(dataStaff[i][0] || "").trim().toLowerCase();
              const name = String(dataStaff[i][1] || "").trim();
              if (!name) continue;
              if (role.includes("responsibility") || role.includes("leader")) leaders.push(name);
              else if (role.includes("assignee") || role.includes("operator")) operators.push(name);
            }
          }
          config.staff = leaders;
          config.assignees = operators;
        } catch (e) { console.warn("Staff Config Load Error", e); }

        return Response.success(config);
      } catch (e) { return Response.error("getTicketConfig Failed: " + e.toString()); }
    },

    saveTicketConfig: function (config) {
      try {
        console.log("[saveTicketConfig] Received Config:", JSON.stringify(config).substring(0, 100) + "...");
        const headers = ["Type", "Status", "Severity", "Category", "SubCategory"];

        const catRows = [];
        if (config.categories) {
          for (const cat in config.categories) {
            const subs = config.categories[cat];
            if (!subs || subs.length === 0) {
              catRows.push({ c: cat, s: "" });
            } else {
              subs.forEach(s => catRows.push({ c: cat, s: s }));
            }
          }
        }

        const maxLen = Math.max(
          (config.types || []).length,
          (config.statuses || []).length,
          (config.severities || []).length,
          catRows.length
        );

        const data = [];
        for (let i = 0; i < maxLen; i++) {
          data.push([
            (config.types && config.types[i]) ? config.types[i] : "",
            (config.statuses && config.statuses[i]) ? config.statuses[i] : "",
            (config.severities && config.severities[i]) ? config.severities[i] : "",
            (i < catRows.length) ? catRows[i].c : "",
            (i < catRows.length) ? catRows[i].s : ""
          ]);
        }

        SheetService.overwriteAll("Setting_Ticket", data, headers);
        return Response.success({ message: "Settings Saved" });
      } catch (e) { return Response.error("Save Failed: " + e.message); }
    },

    // ===================== Email Profiles (Sheet: Setting_EmailProfile) =====================
    getEmailProfiles: function () {
      try {
        const TAB_NAME = "Setting_EmailProfile";
        const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
        let sheet = ss.getSheetByName(TAB_NAME);
        if (!sheet) {
          sheet = ss.insertSheet(TAB_NAME);
          sheet.appendRow(["Name", "To", "CC"]);
          sheet.appendRow(["Default (Huawei VIP)", "AP.TH.MS.VIPSupport@huawei.com", "monomax-noc-eng@mono.co.th"]);
        }
        const data = sheet.getDataRange().getValues();
        if (!data || data.length < 2) return Response.success([]);
        const profiles = [];
        for (let i = 1; i < data.length; i++) {
          const name = String(data[i][0] || "").trim();
          if (!name) continue;
          profiles.push({
            name: name,
            to: String(data[i][1] || "").trim(),
            cc: String(data[i][2] || "").trim()
          });
        }
        return Response.success(profiles);
      } catch (e) { return Response.error("getEmailProfiles Failed: " + e.toString()); }
    },

    saveEmailProfiles: function (profiles) {
      try {
        console.log("[saveEmailProfiles] Saving " + (profiles ? profiles.length : 0) + " profiles.");
        const headers = ["Name", "To", "CC"];
        const arr = profiles || [];
        const data = arr.map(p => [p.name || "", p.to || "", p.cc || ""]);

        SheetService.overwriteAll("Setting_EmailProfile", data, headers);
        return Response.success({ message: "Email Profiles Saved" });
      } catch (e) { return Response.error("saveEmailProfiles Failed: " + e.toString()); }
    },

    // ===================== Email Profiles (Sheet: Setting_EmailProfile -> Now managed via UI as "Recipient Group" or similar) =====================
    // Note: The UI now calls "Email Draft Template" -> "Profile".
    // And "Email Profile" (To/CC only) -> "Recipient Group".

    getEmailDrafts: function () {
      try {
        const TAB_NAME = "Setting_EmailDraft";
        const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
        let sheet = ss.getSheetByName(TAB_NAME);
        if (!sheet) {
          sheet = ss.insertSheet(TAB_NAME);
          sheet.appendRow(["Name", "Greeting", "ShowGreeting", "Note", "ShowNote", "Company", "ContactName", "ContactNum", "SiteName", "SiteNum", "SiteEmail", "SiteAddr", "RootCause", "Action", "Impact", "Schedule"]);
        }
        const data = sheet.getDataRange().getValues();
        if (!data || data.length < 2) return Response.success([]);
        const headers = data[0];
        const drafts = [];
        for (let i = 1; i < data.length; i++) {
          const name = String(data[i][0] || "").trim();
          if (!name) continue;
          drafts.push({
            name: name,
            greeting: String(data[i][1] || "").trim(),
            showGreeting: String(data[i][2] || "true").trim() === "true",
            note: String(data[i][3] || "").trim(),
            showNote: String(data[i][4] || "true").trim() === "true",
            company: String(data[i][5] || "").trim(),
            contactName: String(data[i][6] || "").trim(),
            contactNum: String(data[i][7] || "").trim(),
            siteName: String(data[i][8] || "").trim(),
            siteNum: String(data[i][9] || "").trim(),
            siteEmail: String(data[i][10] || "").trim(),
            siteAddr: String(data[i][11] || "").trim(),
            rootCause: String(data[i][12] || "").trim(),
            action: String(data[i][13] || "").trim(),
            impact: String(data[i][14] || "").trim(),
            schedule: String(data[i][15] || "").trim()
          });
        }
        return Response.success(drafts);
      } catch (e) { return Response.error("getEmailDrafts Failed: " + e.toString()); }
    },

    saveEmailDrafts: function (drafts) {
      try {
        console.log("[saveEmailDrafts] Saving " + (drafts ? drafts.length : 0) + " drafts.");
        const headers = ["Name", "Greeting", "ShowGreeting", "Note", "ShowNote", "Company", "ContactName", "ContactNum", "SiteName", "SiteNum", "SiteEmail", "SiteAddr", "RootCause", "Action", "Impact", "Schedule"];
        const arr = drafts || [];
        const data = arr.map(d => [
          d.name || "", d.greeting || "", String(d.showGreeting !== false),
          d.note || "", String(d.showNote !== false),
          d.company || "", d.contactName || "", d.contactNum || "",
          d.siteName || "", d.siteNum || "", d.siteEmail || "", d.siteAddr || "",
          d.rootCause || "", d.action || "", d.impact || "", d.schedule || ""
        ]);

        SheetService.overwriteAll("Setting_EmailDraft", data, headers);
        return Response.success({ message: "Email Drafts Saved" });
      } catch (e) { return Response.error("saveEmailDrafts Failed: " + e.toString()); }
    },

    // ===================== New: Mail Drafts (Sheet: Setting_MailDraft) =====================
    getMailDrafts: function () {
      try {
        const TAB_NAME = "Setting_MailDraft";
        const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
        let sheet = ss.getSheetByName(TAB_NAME);
        if (!sheet) {
          sheet = ss.insertSheet(TAB_NAME);
          // Stores basically everything in the Email Tab
          sheet.appendRow([
            "Name", "Subject", "To", "CC",
            "Greeting", "ShowGreeting", "Note", "ShowNote",
            "Company", "ContactName", "ContactNum",
            "SiteName", "SiteNum", "SiteEmail", "SiteAddr",
            "RootCause", "Action", "Impact", "Schedule"
          ]);
        }
        const data = sheet.getDataRange().getValues();
        if (!data || data.length < 2) return Response.success([]);
        const drafts = [];
        for (let i = 1; i < data.length; i++) {
          const name = String(data[i][0] || "").trim();
          if (!name) continue;
          drafts.push({
            name: name,
            subject: String(data[i][1] || "").trim(),
            to: String(data[i][2] || "").trim(),
            cc: String(data[i][3] || "").trim(),
            greeting: String(data[i][4] || "").trim(),
            showGreeting: String(data[i][5] || "true").trim() === "true",
            note: String(data[i][6] || "").trim(),
            showNote: String(data[i][7] || "true").trim() === "true",
            company: String(data[i][8] || "").trim(),
            contactName: String(data[i][9] || "").trim(),
            contactNum: String(data[i][10] || "").trim(),
            siteName: String(data[i][11] || "").trim(),
            siteNum: String(data[i][12] || "").trim(),
            siteEmail: String(data[i][13] || "").trim(),
            siteAddr: String(data[i][14] || "").trim(),
            rootCause: String(data[i][15] || "").trim(),
            action: String(data[i][16] || "").trim(),
            impact: String(data[i][17] || "").trim(),
            schedule: String(data[i][18] || "").trim()
          });
        }
        return Response.success(drafts);
      } catch (e) { return Response.error("getMailDrafts Failed: " + e.toString()); }
    },

    saveMailDrafts: function (drafts) {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(5000)) {
        try {
          const TAB_NAME = "Setting_MailDraft";
          const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
          let sheet = ss.getSheetByName(TAB_NAME);
          if (!sheet) sheet = ss.insertSheet(TAB_NAME);
          sheet.clear();
          sheet.appendRow([
            "Name", "Subject", "To", "CC",
            "Greeting", "ShowGreeting", "Note", "ShowNote",
            "Company", "ContactName", "ContactNum",
            "SiteName", "SiteNum", "SiteEmail", "SiteAddr",
            "RootCause", "Action", "Impact", "Schedule"
          ]);
          const arr = drafts || [];
          if (arr.length > 0) {
            const data = arr.map(d => [
              d.name || "", d.subject || "", d.to || "", d.cc || "",
              d.greeting || "", String(d.showGreeting !== false),
              d.note || "", String(d.showNote !== false),
              d.company || "", d.contactName || "", d.contactNum || "",
              d.siteName || "", d.siteNum || "", d.siteEmail || "", d.siteAddr || "",
              d.rootCause || "", d.action || "", d.impact || "", d.schedule || ""
            ]);
            sheet.getRange(2, 1, data.length, 19).setValues(data);
          }
          return Response.success({ message: "Mail Drafts Saved" });
        } catch (e) { return Response.error("saveMailDrafts Failed: " + e.toString()); } finally { lock.releaseLock(); }
      }
      return Response.error("System Busy");
    },

    // ✅ importTicket: Smart Insert + Date Object
    importTicket: function (data) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getTicketSheet();
          const rawData = sheet.getDataRange().getValues();
          const headers = rawData[0];

          // 1. เช็คซ้ำ
          const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
          if (idCol > -1 && rawData.length > 1) {
            const ids = rawData.slice(1).map(row => String(row[idCol]).trim());
            if (ids.includes(data.id)) return { success: false, message: "Duplicate ID" };
          }

          // 2. หาตำแหน่งแทรก (Smart Insert)
          const noCol = _findColIndex(headers, ["No.", "ลำดับ"]);
          let insertRowIndex = -1;
          let existingNo = null;
          if (idCol > -1) {
            for (let i = 1; i < rawData.length; i++) {
              if (!rawData[i][idCol] || String(rawData[i][idCol]).trim() === "") {
                insertRowIndex = i + 1;
                if (noCol > -1) existingNo = rawData[i][noCol];
                break;
              }
            }
          }

          // 3. เตรียมข้อมูล
          const newRow = new Array(headers.length).fill("");
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

          if (insertRowIndex > -1 && existingNo) setRowVal(["No.", "ลำดับ"], existingNo);
          else setRowVal(["No.", "ลำดับ"], rawData.length);

          setRowVal(["Date", "วันที่แจ้ง"], importDate); // Object
          setRowVal(["Ticket Number", "ID"], data.id);
          setRowVal(["Ticket Type", "Type"], data.type || "Request");
          setRowVal(["Ticket Status", "Status"], data.status || "Draft");
          setRowVal(["Severity", "ความรุนแรง"], data.severity || "Normal");
          setRowVal(["Category", "หมวดหมู่"], data.category || "General");
          setRowVal(["Sub Category", "หมวดหมู่ย่อย"], data.subCategory || "-");
          setRowVal(["Short Description & Subject", "Subject", "หัวข้อ"], data.subject);
          setRowVal(["Detail", "รายละเอียด"], data.detail);
          setRowVal(["Created Date", "Created"], today);
          setRowVal(["Remark", "หมายเหตุ"], `Thread ID: ${data.threadId}`);

          // 4. บันทึก & Format
          let targetRow = -1;
          if (insertRowIndex > -1) {
            sheet.getRange(insertRowIndex, 1, 1, newRow.length).setValues([newRow]);
            targetRow = insertRowIndex;
          } else {
            sheet.appendRow(newRow);
            targetRow = sheet.getLastRow();
          }

          const dateCol = _findColIndex(headers, ["Date", "วันที่แจ้ง"]);
          if (dateCol > -1) _setCellFormat(sheet, targetRow, dateCol, "dd/MM/yyyy");
          const createdCol = _findColIndex(headers, ["Created Date", "Created"]);
          if (createdCol > -1) _setCellFormat(sheet, targetRow, createdCol, "dd/MM/yyyy HH:mm:ss");

          return { success: true, id: data.id };
        } else {
          return { success: false, message: "System Busy" };
        }
      } catch (e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
    },

    createTicketAndDraft: function (payload) {
      const { ticket, email } = payload;
      let res;

      // Determine if Create or Update
      const allIds = this.getAllTicketIds();
      const isUpdate = ticket.id && allIds.includes(String(ticket.id).trim().toUpperCase());

      if (isUpdate) {
        res = TicketController.updateTicket(ticket);
      } else {
        res = TicketController.createTicket(ticket);
      }

      if (!res.success) return res;

      // Create Gmail Draft
      try {
        const draft = GmailApp.createDraft(
          email.to || "",
          email.subject || "(No Subject)",
          "", // Plain text body
          {
            htmlBody: email.bodyHtml || "",
            cc: email.cc || ""
          }
        );
        // Construct a link to open the draft
        // Note: The ID returned by getId() is the message ID, draft ID might be different but usually works in URL
        const draftId = draft.getId();
        return {
          success: true,
          message: "Ticket saved & Draft created",
          draftId: draftId,
          draftUrl: `https://mail.google.com/mail/u/0/#drafts/${draftId}`
        };
      } catch (e) {
        return { success: true, message: "Ticket saved but draft creation failed: " + e.message };
      }
    },

    // เพิ่มฟังก์ชันสำหรับดึง ID ทั้งหมดมาเช็คซ้ำแบบเร็วๆ
    getAllTicketIds: function () {
      const sheet = _getTicketSheet();
      const data = sheet.getDataRange().getValues();
      if (data.length < 2) return [];
      const headers = data[0];
      const idCol = _findColIndex(headers, ["Ticket Number", "ID"]);
      if (idCol === -1) return [];

      // Return Array of IDs
      return data.slice(1).map(r => String(r[idCol]).trim().toUpperCase());
    },

    getStats: function () {
      const sheet = _getTicketSheet();
      const lastRow = sheet.getLastRow();
      return { total: lastRow > 1 ? lastRow - 1 : 0 };
    },

    // ===================== NEW: Setting_MailDraft (User Saved Drafts) =====================
    getMailDrafts: function () {
      try {
        const TAB_NAME = "Setting_MailDraft";
        const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
        let sheet = ss.getSheetByName(TAB_NAME);
        if (!sheet) {
          sheet = ss.insertSheet(TAB_NAME);
          sheet.appendRow([
            "Name", "Subject", "To", "CC", "Greeting", "ShowGreeting", "Note", "ShowNote",
            "Company", "ContactName", "ContactNum", "SiteName", "SiteNum", "SiteEmail", "SiteAddr",
            "RootCause", "Action", "Impact", "Schedule"
          ]);
        }
        const data = sheet.getDataRange().getValues();
        if (!data || data.length < 2) return Response.success([]);

        const drafts = [];
        for (let i = 1; i < data.length; i++) {
          const name = String(data[i][0] || "").trim();
          if (!name) continue;
          drafts.push({
            name: name,
            subject: String(data[i][1] || ""),
            to: String(data[i][2] || ""),
            cc: String(data[i][3] || ""),
            greeting: String(data[i][4] || ""),
            showGreeting: String(data[i][5] || "true") === "true",
            note: String(data[i][6] || ""),
            showNote: String(data[i][7] || "true") === "true",
            company: String(data[i][8] || ""),
            contactName: String(data[i][9] || ""),
            contactNum: String(data[i][10] || ""),
            siteName: String(data[i][11] || ""),
            siteNum: String(data[i][12] || ""),
            siteEmail: String(data[i][13] || ""),
            siteAddr: String(data[i][14] || ""),
            rootCause: String(data[i][15] || ""),
            action: String(data[i][16] || ""),
            impact: String(data[i][17] || ""),
            schedule: String(data[i][18] || "")
          });
        }
        return Response.success(drafts);
      } catch (e) { return Response.error("getMailDrafts Failed: " + e.toString()); }
    },

    saveMailDrafts: function (drafts) {
      try {
        console.log("[saveMailDrafts] Saving " + (drafts ? drafts.length : 0) + " mail drafts.");
        const headers = [
          "Name", "Subject", "To", "CC", "Greeting", "ShowGreeting", "Note", "ShowNote",
          "Company", "ContactName", "ContactNum", "SiteName", "SiteNum", "SiteEmail", "SiteAddr",
          "RootCause", "Action", "Impact", "Schedule"
        ];
        const arr = drafts || [];
        const data = arr.map(d => [
          d.name || "", d.subject || "", d.to || "", d.cc || "",
          d.greeting || "", String(d.showGreeting !== false),
          d.note || "", String(d.showNote !== false),
          d.company || "", d.contactName || "", d.contactNum || "",
          d.siteName || "", d.siteNum || "", d.siteEmail || "", d.siteAddr || "",
          d.rootCause || "", d.action || "", d.impact || "", d.schedule || ""
        ]);

        SheetService.overwriteAll("Setting_MailDraft", data, headers);
        return Response.success({ message: "Mail Drafts Saved" });
      } catch (e) { return Response.error("saveMailDrafts Failed: " + e.toString()); }
    },

    // ===================== New: Staff & Assignees (Setting_Staff) =====================
    getStaffAndAssignees: function () {
      try {
        const sheet = SheetService.ensureSheet("Setting_Staff", ["Role", "Name"]);
        const data = sheet.getDataRange().getValues();
        if (!data || data.length < 2) return Response.success({ leaders: [], operators: [] });

        const leaders = [];
        const operators = [];

        for (let i = 1; i < data.length; i++) {
          const role = String(data[i][0] || "").trim().toLowerCase();
          const name = String(data[i][1] || "").trim();
          if (!name) continue;

          if (role.includes("responsibility") || role.includes("leader")) {
            leaders.push(name);
          } else if (role.includes("assignee") || role.includes("operator")) {
            operators.push(name);
          }
        }
        return Response.success({ leaders, operators });
      } catch (e) { return Response.error("getStaffAndAssignees Failed: " + e.toString()); }
    },

    saveStaffAndAssignees: function (data) {
      try {
        console.log("[saveStaffAndAssignees] Saving staff data...");
        const headers = ["Role", "Name"];
        const rows = [];
        if (data.leaders && Array.isArray(data.leaders)) {
          data.leaders.forEach(name => {
            if (name && name.trim()) rows.push(["Responsibility", name.trim()]);
          });
        }
        if (data.operators && Array.isArray(data.operators)) {
          data.operators.forEach(name => {
            if (name && name.trim()) rows.push(["Assignee", name.trim()]);
          });
        }

        SheetService.overwriteAll("Setting_Staff", rows, headers);
        return Response.success({ message: "Staff Saved" });
      } catch (e) { return Response.error("saveStaffAndAssignees Failed: " + e.toString()); }
    }
  };
})();