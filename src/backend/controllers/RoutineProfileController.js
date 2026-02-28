/**
 * RoutineProfileController.js
 * Handles saving and retrieving routine profiles for tickets.
 */
const RoutineProfileController = (() => {
  const SHEET_NAME = "Routine_Profiles";

  function _getProfileSheet() {
    const dbId = typeof CONFIG !== "undefined" ? CONFIG.DB_ID : "";
    if (!dbId) throw new Error("Database ID (Core Sheet) Missing in Config");
    const ss = SpreadsheetApp.openById(dbId);
    let sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(["Profile Name", "Data JSON", "Created Date", "Auto Load"]);
      sheet.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#f3f4f6");
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  return {
    /**
     * บันทึก Profile ใหม่
     */
    saveRoutineProfile: function (profileName, formData) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getProfileSheet();
          const data = sheet.getDataRange().getValues();
          
          // ตรวจสอบชื่อซ้ำ
          const existingIdx = data.findIndex(row => row[0] === profileName);
          const rowData = [profileName, JSON.stringify(formData), new Date(), ""];

          if (existingIdx !== -1) {
            // อัปเดตทับถ้าชื่อซ้ำ (คงค่า Auto Load เดิมไว้)
            rowData[3] = data[existingIdx][3];
            sheet.getRange(existingIdx + 1, 1, 1, 4).setValues([rowData]);
          } else {
            // เพิ่มแถวใหม่
            sheet.appendRow(rowData);
          }
          
          return Response.success({ message: "บันทึก Profile '" + profileName + "' สำเร็จ" });
        }
      } catch (e) {
        return Response.error("saveRoutineProfile Failed: " + e.toString());
      } finally {
        lock.releaseLock();
      }
    },

    /**
     * ดึงรายชื่อ Profile ทั้งหมด
     */
    getRoutineProfiles: function () {
      try {
        const sheet = _getProfileSheet();
        const data = sheet.getDataRange().getValues();
        if (data.length < 2) return Response.success([]);

        const profiles = data.slice(1).map(row => {
          return {
            name: row[0],
            data: JSON.parse(row[1]),
            date: row[2],
            isAutoLoad: row[3] === "TRUE" || row[3] === true
          };
        });

        return Response.success(profiles);
      } catch (e) {
        return Response.error("getRoutineProfiles Failed: " + e.toString());
      }
    },

    /**
     * ตั้งค่า Auto Load (เลือกได้แค่ 1 เดียว)
     */
    setAutoLoad: function (profileName, isEnabled) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getProfileSheet();
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          const autoCol = headers.indexOf("Auto Load");
          
          if (autoCol === -1) return Response.error("Column 'Auto Load' not found");

          // เคลียร์ทุกลูกก่อน (เพราะมีได้แค่ 1)
          if (isEnabled) {
            for (let i = 1; i < data.length; i++) {
              sheet.getRange(i + 1, autoCol + 1).setValue("");
            }
          }

          const idx = data.findIndex(row => row[0] === profileName);
          if (idx !== -1) {
            sheet.getRange(idx + 1, autoCol + 1).setValue(isEnabled ? "TRUE" : "");
            return Response.success({ message: isEnabled ? "ตั้งค่า Auto Load สำเร็จ" : "ยกเลิก Auto Load สำเร็จ" });
          }
          return Response.error("ไม่พบ Profile: " + profileName);
        }
      } catch (e) {
        return Response.error("setAutoLoad Failed: " + e.toString());
      } finally {
        lock.releaseLock();
      }
    },

    /**
     * ลบ Profile
     */
    deleteRoutineProfile: function (profileName) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getProfileSheet();
          const data = sheet.getDataRange().getValues();
          const idx = data.findIndex(row => row[0] === profileName);

          if (idx !== -1) {
            sheet.deleteRow(idx + 1);
            return Response.success({ message: "ลบ Profile '" + profileName + "' สำเร็จ" });
          }
          return Response.error("ไม่พบ Profile: " + profileName);
        }
      } catch (e) {
        return Response.error("deleteRoutineProfile Failed: " + e.toString());
      } finally {
        lock.releaseLock();
      }
    }
  };
})();
