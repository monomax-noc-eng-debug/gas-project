/**
 * src/backend/controllers/HandoverController.js
 */
const HandoverController = (() => {
  const TABLE_NAME = "DB_Handover";

  function _getTeamMembers() {
    try {
      const dbId = typeof CONFIG !== "undefined" ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty("CORE_SHEET_ID");
      const ss = SpreadsheetApp.openById(dbId);
      const sheet = ss.getSheetByName("SYS_Users");
      if (!sheet) return [];
      const rawData = sheet.getDataRange().getValues();
      if (rawData && rawData.length > 1) {
        const members = [];
        for (let i = 1; i < rawData.length; i++) {
          const role = String(rawData[i][0]).trim().toLowerCase();
          const name = String(rawData[i][1]).trim();
          if (name && role.includes("responsibility")) members.push(name);
        }
        if (members.length > 0) return [...new Set(members)];
      }
    } catch (e) { }
    return [];
  }

  function _getTags() {
    try {
      const dbId = typeof CONFIG !== "undefined" ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty("CORE_SHEET_ID");
      const ss = SpreadsheetApp.openById(dbId);
      const sheet = ss.getSheetByName("SYS_Handover_Tags");
      if (sheet) {
        const rawData = sheet.getDataRange().getValues();
        if (rawData.length > 1) {
          return rawData.slice(1).map(r => String(r[0] || "").trim()).filter(t => t !== "");
        }
      }
    } catch (e) { }
    return ["Ticket", "REQ", "Customer", "Routine", "Incident"];
  }

  function _getHandoverSheet() {
    const dbId = typeof CONFIG !== "undefined" ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty("CORE_SHEET_ID");
    const ss = SpreadsheetApp.openById(dbId);
    let sheet = ss.getSheetByName(TABLE_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(TABLE_NAME);
      sheet.appendRow(["Handover_ID", "Timestamp", "Shift", "Creator", "Tags", "Topic", "Detail", "Contact", "Acknowledged", "Status"]);
    }
    return sheet;
  }

  return {

    getHandovers: function () {
      try {
        const sheet = _getHandoverSheet();
        const data = sheet.getDataRange().getValues();
        const team = _getTeamMembers();
        const tags = _getTags();

        if (!data || data.length < 2) return Response.success({ team: team, tags: tags, items: [] });

        const items = data.slice(1).map(row => {
          let ackObj = {};
          try { ackObj = row[8] ? JSON.parse(row[8]) : {}; } catch (e) { }

          // ✨ แปลง String Tag ในชีตให้เป็น Array (แยกด้วยลูกน้ำ)
          const tagsArray = row[4] ? String(row[4]).split(',').map(t => t.trim()).filter(t => t !== "") : [];

          return {
            id: row[0],
            timestamp: row[1],
            shift: row[2],
            creator: row[3],
            tags: tagsArray, // ส่งออกเป็น Array ให้หน้าบ้าน
            topic: row[5],
            detail: row[6],
            contact: row[7],
            acknowledged: ackObj,
            status: row[9]
          };
        }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return Response.success({ team: team, tags: tags, items: items });
      } catch (e) {
        return Response.error("Get Handover Failed: " + e.message);
      }
    },

    createHandover: function (data) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(15000)) {
          const sheet = _getHandoverSheet();
          const tz = typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
          const now = new Date();
          const newId = "HO-" + Utilities.formatDate(now, tz, "yyMMdd-HHmmss");

          const hour = now.getHours();
          const shift = (hour >= 8 && hour < 20) ? "Day" : "Night";

          // ✨ บันทึก Tag Array เป็น String แบบมีลูกน้ำคั่น
          const tagsString = Array.isArray(data.tags) ? data.tags.join(', ') : "";

          const newRow = [
            newId,
            now,
            shift,
            data.creator || "Unknown",
            tagsString,
            data.topic || "",
            data.detail || "",
            data.contact || "",
            JSON.stringify({}),
            "Pending"
          ];

          sheet.appendRow(newRow);
          return Response.success({ message: "สร้างการส่งกะเรียบร้อย", id: newId });
        }
      } catch (e) {
        return Response.error(e.message);
      } finally {
        lock.releaseLock();
      }
    },

    acknowledgeHandover: function (payload) {
      const { id, name } = payload;
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(15000)) {
          const sheet = _getHandoverSheet();
          const data = sheet.getDataRange().getValues();
          let rowIdx = -1;
          for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][0]) === String(id)) {
              rowIdx = i + 1;
              break;
            }
          }
          if (rowIdx === -1) return Response.error("ไม่พบรายการ");

          let ackObj = {};
          if (data[rowIdx - 1][8]) {
            try { ackObj = JSON.parse(data[rowIdx - 1][8]); } catch (e) { }
          }

          let actionMsg = "";
          if (ackObj[name]) {
            delete ackObj[name];
            actionMsg = "ยกเลิกการรับทราบแล้ว";
          } else {
            const tz = typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
            ackObj[name] = Utilities.formatDate(new Date(), tz, "HH:mm");
            actionMsg = "บันทึกการรับทราบแล้ว";
          }

          const team = _getTeamMembers();
          let status = "Pending";
          if (team.length > 0 && Object.keys(ackObj).length >= team.length) {
            status = "Succeed";
          }

          sheet.getRange(rowIdx, 9).setValue(JSON.stringify(ackObj));
          sheet.getRange(rowIdx, 10).setValue(status);

          return Response.success({ message: actionMsg, status: status });
        }
      } catch (e) {
        return Response.error(e.message);
      } finally {
        lock.releaseLock();
      }
    },

    updateHandover: function (data) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(15000)) {
          const sheet = _getHandoverSheet();
          const sheetData = sheet.getDataRange().getValues();
          let rowIdx = -1;
          for (let i = 1; i < sheetData.length; i++) {
            if (String(sheetData[i][0]) === String(data.id)) {
              rowIdx = i + 1;
              break;
            }
          }
          if (rowIdx === -1) return Response.error("ไม่พบรายการ");

          const tagsString = Array.isArray(data.tags) ? data.tags.join(', ') : "";

          sheet.getRange(rowIdx, 5).setValue(tagsString);
          sheet.getRange(rowIdx, 6).setValue(data.topic);
          sheet.getRange(rowIdx, 7).setValue(data.detail);
          sheet.getRange(rowIdx, 8).setValue(data.contact);

          return Response.success({ message: "อัปเดตข้อมูลเรียบร้อย" });
        }
      } catch (e) {
        return Response.error(e.message);
      } finally {
        lock.releaseLock();
      }
    },

    deleteHandover: function (id) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(15000)) {
          const sheet = _getHandoverSheet();
          const sheetData = sheet.getDataRange().getValues();
          let rowIdx = -1;
          for (let i = 1; i < sheetData.length; i++) {
            if (String(sheetData[i][0]) === String(id)) {
              rowIdx = i + 1;
              break;
            }
          }
          if (rowIdx === -1) return Response.error("ไม่พบรายการ");
          sheet.deleteRow(rowIdx);
          return Response.success({ message: "ลบรายการเรียบร้อย" });
        }
      } catch (e) {
        return Response.error(e.message);
      } finally {
        lock.releaseLock();
      }
    }
  };
})();