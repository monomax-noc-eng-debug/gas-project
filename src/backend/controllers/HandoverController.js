/**
 * src/backend/controllers/HandoverController.js
 */
const HandoverController = (() => {
  const TABLE_NAME = "DB_Handover";

  function _getTeamMembers() {
    try {
      const settings = SettingController.apiGetAllSettings().data;
      if (settings && settings.staff) return settings.staff;
    } catch (e) { }
    return [];
  }

  function _getTags() {
    try {
      const settings = SettingController.apiGetAllSettings().data;
      if (settings && settings.handoverTags) return settings.handoverTags;
    } catch (e) { }
    return ["Ticket", "REQ", "Customer", "Routine", "Incident"];
  }

  function _getTypes() {
    try {
      const settings = SettingController.apiGetAllSettings().data;
      if (settings && settings.types) return settings.types;
    } catch (e) { }
    return ["Incident", "Request"];
  }

  function _getHandoverSheet() {
    const dbId = typeof CONFIG !== "undefined" ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty("CORE_SHEET_ID");
    const ss = SpreadsheetApp.openById(dbId);
    let sheet = ss.getSheetByName(TABLE_NAME);
    const headers = ["Handover_ID", "Timestamp", "Shift", "Creator", "Tags", "Topic", "Detail", "Contact", "Acknowledged", "Status", "Type"];

    if (!sheet) {
      sheet = ss.insertSheet(TABLE_NAME);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f4f6");
      sheet.setFrozenRows(1);
    } else {
      // Ensure headers match the current data structure
      const currentLastCol = sheet.getLastColumn() || 1;
      if (currentLastCol < headers.length) {
        // Expand if needed
        const maxCols = sheet.getMaxColumns();
        if (maxCols < headers.length) {
          sheet.insertColumnsAfter(maxCols, headers.length - maxCols);
        }
      }
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f4f6");
    }
    return sheet;
  }

  return {

    getHandovers: function () {
      try {
        const team = _getTeamMembers();
        const tags = _getTags();
        const types = _getTypes();

        let data = [];
        try {
          data = SheetService.getAll(TABLE_NAME, 600); // 10 minutes cache
        } catch (e) {
          // Fallback if sheet doesn't exist yet, we ensure it
          _getHandoverSheet();
          data = SheetService.getAll(TABLE_NAME, 600);
        }

        if (!data || data.length < 2) return Response.success({ team: team, tags: tags, types: types, items: [] });

        // ✨ จำเป็นต้องจำกัดข้อมูล เพื่อป้องกัน Payload ใหญ่เกินไปเมื่อใช้ไปนานๆ (ดึงแค่ 300 รายการล่าสุด)
        let dataToProcess = data.slice(1);
        if (dataToProcess.length > 300) {
          dataToProcess = dataToProcess.slice(-300);
        }

        const items = dataToProcess.map(row => {
          let ackObj = {};
          try { ackObj = row[8] ? JSON.parse(row[8]) : {}; } catch (e) { }

          const tagsArray = row[4] ? String(row[4]).split(',').map(t => t.trim()).filter(t => t !== "") : [];

          return {
            id: row[0],
            timestamp: row[1],
            shift: row[2],
            creator: row[3],
            tags: tagsArray,
            topic: row[5],
            detail: row[6],
            contact: row[7],
            acknowledged: ackObj,
            status: row[9],
            type: row[10] || ""
          };
        }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return Response.success({ team: team, tags: tags, types: types, items: items });
      } catch (e) {
        return Response.error("Get Handover Failed: " + e.message);
      }
    },

    createHandover: function (data) {
      const lock = LockService.getScriptLock();
      try {
        // ✨ ดักจับกรณีที่ Lock ไม่สำเร็จ
        if (!lock.tryLock(15000)) return Response.error("ระบบกำลังยุ่ง กรุณาลองใหม่ในอีกสักครู่");

        const sheet = _getHandoverSheet();
        const tz = typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
        let now = new Date();
        if (data.overrideDate && data.overrideTime) {
          try {
            const dp = data.overrideDate.split('-');
            const tp = data.overrideTime.split(':');
            if (dp.length === 3 && tp.length === 2) {
              const parsedDate = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]), parseInt(tp[0]), parseInt(tp[1]), 0);
              if (!isNaN(parsedDate.getTime())) now = parsedDate;
            }
          } catch (e) { }
        }

        const newId = "HO-" + Utilities.formatDate(new Date(), tz, "yyMMdd-HHmmss");

        let shift = data.shift;
        if (!shift || shift === "Auto") {
          const hour = now.getHours();
          shift = (hour >= 8 && hour < 20) ? "Day" : "Night";
        }

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
          "Pending",
          data.type || ""
        ];

        sheet.appendRow(newRow);
        return Response.success({ message: "สร้างการส่งกะเรียบร้อย", id: newId });

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
        if (!lock.tryLock(15000)) return Response.error("ระบบกำลังยุ่ง กรุณาลองใหม่ในอีกสักครู่");

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

        // อัปเดตชีต
        sheet.getRange(rowIdx, 9).setValue(JSON.stringify(ackObj));
        sheet.getRange(rowIdx, 10).setValue(status);

        return Response.success({ message: actionMsg, status: status });

      } catch (e) {
        return Response.error(e.message);
      } finally {
        lock.releaseLock();
      }
    },

    updateHandover: function (data) {
      const lock = LockService.getScriptLock();
      try {
        if (!lock.tryLock(15000)) return Response.error("ระบบกำลังยุ่ง กรุณาลองใหม่ในอีกสักครู่");

        const sheet = _getHandoverSheet();
        const sheetData = sheet.getDataRange().getValues();
        let rowIdx = -1;

        // ✨ ค้นหาจากล่างขึ้นบน จะเจอไวกว่าสำหรับงานใหม่ๆ
        for (let i = sheetData.length - 1; i >= 1; i--) {
          if (String(sheetData[i][0]) === String(data.id)) {
            rowIdx = i + 1;
            break;
          }
        }
        if (rowIdx === -1) return Response.error("ไม่พบรายการ");

        const tagsString = Array.isArray(data.tags) ? data.tags.join(', ') : "";

        let ts = new Date();
        if (data.overrideDate && data.overrideTime) {
          try {
            const dp = data.overrideDate.split('-');
            const tp = data.overrideTime.split(':');
            if (dp.length === 3 && tp.length === 2) {
              const parsedDate = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]), parseInt(tp[0]), parseInt(tp[1]), 0);
              if (!isNaN(parsedDate.getTime())) ts = parsedDate;
            }
          } catch (e) { }
        }
        sheet.getRange(rowIdx, 2).setValue(ts);

        // Calculate shift based on current time if 'Auto' is selected
        if (data.shift && data.shift !== "Auto") {
          sheet.getRange(rowIdx, 3).setValue(data.shift);
        } else {
          const hour = ts.getHours();
          const shiftAuto = (hour >= 8 && hour < 20) ? "Day" : "Night";
          sheet.getRange(rowIdx, 3).setValue(shiftAuto);
        }

        // Ensure sufficient columns
        const maxCol = sheet.getMaxColumns();
        if (maxCol < 11) sheet.insertColumnsAfter(maxCol, 11 - maxCol);

        sheet.getRange(rowIdx, 4).setValue(data.creator || "Unknown");
        sheet.getRange(rowIdx, 5).setValue(tagsString);
        sheet.getRange(rowIdx, 6).setValue(data.topic);
        sheet.getRange(rowIdx, 7).setValue(data.detail);
        sheet.getRange(rowIdx, 8).setValue(data.contact);
        sheet.getRange(rowIdx, 11).setValue(data.type || "");

        return Response.success({ message: "อัปเดตข้อมูลเรียบร้อย" });

      } catch (e) {
        return Response.error(e.message);
      } finally {
        lock.releaseLock();
      }
    },

    deleteHandover: function (id) {
      const lock = LockService.getScriptLock();
      try {
        if (!lock.tryLock(15000)) return Response.error("ระบบกำลังยุ่ง กรุณาลองใหม่ในอีกสักครู่");

        const sheet = _getHandoverSheet();
        const sheetData = sheet.getDataRange().getValues();
        let rowIdx = -1;

        // ✨ ค้นหาจากล่างขึ้นบน
        for (let i = sheetData.length - 1; i >= 1; i--) {
          if (String(sheetData[i][0]) === String(id)) {
            rowIdx = i + 1;
            break;
          }
        }
        if (rowIdx === -1) return Response.error("ไม่พบรายการ");

        sheet.deleteRow(rowIdx);
        return Response.success({ message: "ลบรายการเรียบร้อย" });

      } catch (e) {
        return Response.error(e.message);
      } finally {
        lock.releaseLock();
      }
    },

    // ✨ เพิ่มฟังก์ชันใหม่ สำหรับปุ่ม Quick Resolve หน้าเว็บ
    resolveHandover: function (id) {
      const lock = LockService.getScriptLock();
      try {
        if (!lock.tryLock(15000)) return Response.error("ระบบกำลังยุ่ง กรุณาลองใหม่ในอีกสักครู่");

        const sheet = _getHandoverSheet();
        const sheetData = sheet.getDataRange().getValues();
        let rowIdx = -1;

        for (let i = sheetData.length - 1; i >= 1; i--) {
          if (String(sheetData[i][0]) === String(id)) {
            rowIdx = i + 1;
            break;
          }
        }
        if (rowIdx === -1) return Response.error("ไม่พบรายการ");

        // คอลัมน์ที่ 10 คือ Status
        sheet.getRange(rowIdx, 10).setValue("Succeed");

        return Response.success({ message: "สถานะเปลี่ยนเป็นเสร็จสิ้นเรียบร้อย" });

      } catch (e) {
        return Response.error(e.message);
      } finally {
        lock.releaseLock();
      }
    }

  };
})();