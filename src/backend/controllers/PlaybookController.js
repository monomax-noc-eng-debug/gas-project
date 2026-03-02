/**
 * src/backend/controllers/PlaybookController.js
 */
const PlaybookController = (() => {
  const TAB_NAME = "DB_Playbooks";

  function _uploadImageToDrive(base64String, fileName, subFolderName) {
    if (!base64String) return null;
    try {
      const rootFolderId = typeof CONFIG !== "undefined" && CONFIG.IMG_FOLDER
        ? CONFIG.IMG_FOLDER
        : PropertiesService.getScriptProperties().getProperty("IMG_FOLDER_ID");

      const rootFolder = DriveApp.getFolderById(rootFolderId);
      const mainFolderName = "Playbook_Images";
      let mainFolder;
      const mainFolders = rootFolder.getFoldersByName(mainFolderName);
      if (mainFolders.hasNext()) {
        mainFolder = mainFolders.next();
      } else {
        mainFolder = rootFolder.createFolder(mainFolderName);
        mainFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      }

      let targetFolder = mainFolder;
      if (subFolderName) {
        const safeSubName = subFolderName.replace(/[\/\\]/g, "_").substring(0, 100);
        const subFolders = mainFolder.getFoldersByName(safeSubName);
        if (subFolders.hasNext()) {
          targetFolder = subFolders.next();
        } else {
          targetFolder = mainFolder.createFolder(safeSubName);
          targetFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        }
      }

      const splitBase = base64String.split(',');
      const type = splitBase[0].split(';')[0].replace('data:', '');
      const byteCharacters = Utilities.base64Decode(splitBase[1]);
      const blob = Utilities.newBlob(byteCharacters, type, fileName || 'Playbook_Img_' + new Date().getTime() + '.jpg');

      const file = targetFolder.createFile(blob);

      // ✨ สำคัญมาก: บังคับแชร์ไฟล์ให้เป็น Viewable by link ทันทีที่สร้างไฟล์ ✨
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      return "https://lh3.googleusercontent.com/d/" + file.getId();
    } catch (e) {
      console.error("Upload Image Error:", e);
      return null;
    }
  }

  return {
    getPlaybooks: function () {
      try {
        const data = SheetService.getAll(TAB_NAME, 600);
        if (!data || data.length < 2) return Response.success([]);

        const headers = data[0];
        const rows = data.slice(1);

        const playbooks = rows.map(row => {
          let obj = {};
          headers.forEach((h, i) => obj[h.trim()] = row[i]);
          return obj;
        });

        return Response.success(playbooks);
      } catch (e) {
        return Response.error("getPlaybooks Failed: " + e.message);
      }
    },

    savePlaybook: function (payload) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(30000)) {
          const requiredHeaders = [
            "ID", "Category", "Creator", "Title", "Summary", "Full_Detail",
            "External_Link", "Update_Note", "Update_By_Name", "Cover_Image", "Steps_JSON", "Contacts_JSON", "Updated_At", "Updated_By", "History_JSON"
          ];
          const sheet = SheetService.ensureSheet(TAB_NAME, requiredHeaders);

          const userEmail = Session.getActiveUser().getEmail() || "Admin";
          const userName = userEmail.split('@')[0];
          const now = new Date();

          const currentHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
          requiredHeaders.forEach(h => {
            if (currentHeaders.indexOf(h) === -1) {
              sheet.getRange(1, sheet.getLastColumn() + 1).setValue(h);
            }
          });
          const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

          let history = [];
          if (payload.id && payload.id.trim() !== "") {
            const allData = SheetService.getAll(TAB_NAME, 0, null, true);
            if (allData && allData.length > 1) {
              const h_idx = allData[0].map(h => h.trim());
              const rows = allData.slice(1);
              const oldRow = rows.find(r => String(r[h_idx.indexOf("ID")]) === String(payload.id));

              if (oldRow) {
                // 📸 ถ่าย Snapshot ข้อมูลเดิมเก็บไว้ทั้งหมด
                const snapshot = {
                  title: oldRow[h_idx.indexOf("Title")],
                  full_detail: oldRow[h_idx.indexOf("Full_Detail")],
                  steps: oldRow[h_idx.indexOf("Steps_JSON")],
                  contacts: oldRow[h_idx.indexOf("Contacts_JSON")],
                  note: payload.update_note || "แก้ไขข้อมูลทั่วไป", // ใช้ Note จากการกดเซฟรอบนี้
                  by: oldRow[h_idx.indexOf("Update_By_Name")] || oldRow[h_idx.indexOf("Updated_By")],
                  date: oldRow[h_idx.indexOf("Updated_At")] || Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss")
                };

                const oldHistoryStr = oldRow[h_idx.indexOf("History_JSON")];
                try { history = oldHistoryStr ? JSON.parse(oldHistoryStr) : []; } catch (e) { history = []; }

                history.unshift(snapshot);
                if (history.length > 10) history = history.slice(0, 10); // เก็บสำรองไว้ 10 เวอร์ชันล่าสุด
              }
            }
          }

          const safeFolderName = payload.title ? payload.title : "Playbook_Unknown";

          let coverUrl = "";
          if (payload.coverBase64 && payload.coverBase64.startsWith('data:image')) {
            coverUrl = _uploadImageToDrive(payload.coverBase64, "Cover_" + payload.coverName, safeFolderName);
          }

          let stepsData = payload.steps || [];
          for (let i = 0; i < stepsData.length; i++) {
            if (stepsData[i].image && stepsData[i].image.startsWith('data:image')) {
              const url = _uploadImageToDrive(stepsData[i].image, "Step_" + (i + 1) + "_" + stepsData[i].fileName, safeFolderName);
              if (url) stepsData[i].image = url;
            }
          }

          let rowData = {};
          rowData["Category"] = payload.category;
          rowData["Creator"] = payload.creator;
          rowData["Title"] = payload.title;
          rowData["Summary"] = payload.summary;
          rowData["Full_Detail"] = payload.full_detail || "";
          rowData["External_Link"] = payload.external_link || "";
          rowData["Update_Note"] = payload.update_note || "";
          rowData["Update_By_Name"] = payload.update_by_name || "";
          rowData["Steps_JSON"] = JSON.stringify(stepsData);
          rowData["Contacts_JSON"] = JSON.stringify(payload.contacts || []);
          rowData["Updated_At"] = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
          rowData["Updated_By"] = userName;
          rowData["History_JSON"] = JSON.stringify(history);

          if (payload.id && payload.id.trim() !== "") {
            if (coverUrl) rowData["Cover_Image"] = coverUrl;
            SheetService.update(TAB_NAME, payload.id, rowData, "ID");
          } else {
            const newId = "PB-" + Utilities.formatDate(now, "Asia/Bangkok", "yyMMddHHmmss");
            rowData["ID"] = newId;
            rowData["Cover_Image"] = coverUrl || "";

            let newRowArray = [];
            headers.forEach(h => {
              newRowArray.push(rowData[h.trim()] !== undefined ? rowData[h.trim()] : "");
            });
            SheetService.add(TAB_NAME, newRowArray);
          }

          const dbId = typeof CONFIG !== "undefined" ? CONFIG.DB_ID : "";
          try { CacheService.getScriptCache().remove(`SHEET_DATA_${dbId}_${TAB_NAME}`); } catch (e) { }

          return Response.success({ message: "Saved!" });
        } else {
          return Response.error("System is busy.");
        }
      } catch (e) {
        console.error("savePlaybook Error:", e);
        return Response.error("Save Failed: " + e.message);
      } finally {
        lock.releaseLock();
      }
    },

    deletePlaybook: function (payload) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(15000)) {
          if (!payload || !payload.id) return Response.error("No Playbook ID provided.");

          SheetService.delete(TAB_NAME, payload.id, "ID");

          const dbId = typeof CONFIG !== "undefined" ? CONFIG.DB_ID : "";
          try { CacheService.getScriptCache().remove(`SHEET_DATA_${dbId}_${TAB_NAME}`); } catch (e) { }

          return Response.success({ message: "Deleted successfully!" });
        } else {
          return Response.error("System is busy.");
        }
      } catch (e) {
        console.error("deletePlaybook Error:", e);
        return Response.error("Delete Failed: " + e.message);
      } finally {
        lock.releaseLock();
      }
    }
  };
})();