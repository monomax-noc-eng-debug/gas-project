/**
 * src/backend/controllers/MatchController.js
 * จัดการข้อมูลงาน (Matches) และปฏิทิน
 * Version: Multi-Image Support (JSON Storage) + Lightweight Polling Trigger
 */

const MatchController = (() => {
  // ✅ 1. Helper Functions (Lazy Load Config)
  const getDbId = () => (typeof CONFIG !== "undefined" ? CONFIG.DB_ID : "");
  const getSheetName = () =>
    typeof CONFIG !== "undefined"
      ? CONFIG.MATCH_TAB || "DB_Matches"
      : "DB_Matches";

  // ✅ Helper: แปลงวันที่ให้รองรับทุกรูปแบบ
  function _parseDate(val) {
    if (!val) return "";
    const tz = typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
    if (val instanceof Date) return Utilities.formatDate(val, tz, "yyyy-MM-dd");
    const strVal = String(val).trim();
    const d = new Date(strVal);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, tz, "yyyy-MM-dd");
    }
    return strVal.split(" ")[0];
  }

  // ✅ Helper: แปลงเวลาให้เป็น HH:mm เสมอ
  function _parseTime(val) {
    if (!val) return "00:00";
    const tz = typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
    if (val instanceof Date) return Utilities.formatDate(val, tz, "HH:mm");
    const strVal = String(val).trim();
    if (strVal.match(/^\d{4}-\d{2}-\d{2}/) || strVal.includes("1899")) {
      const d = new Date(strVal);
      if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, "HH:mm");
    }
    let str = strVal.replace(".", ":");
    if (str.indexOf(":") === 1) str = "0" + str;
    return str.length > 5 ? str.substring(0, 5) : str;
  }

  // ✅ Helper: จัดการ Folder ตามวันที่
  function _getOrCreateDateFolder(rootFolderId, dateObj) {
    try {
      if (!rootFolderId) return null;
      const root = DriveApp.getFolderById(rootFolderId);
      const timezone =
        typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
      const getSubFolder = (parent, name) => {
        const folders = parent.getFoldersByName(name);
        return folders.hasNext() ? folders.next() : parent.createFolder(name);
      };
      const yearFolder = getSubFolder(
        root,
        Utilities.formatDate(dateObj, timezone, "yyyy"),
      );
      const monthFolder = getSubFolder(
        yearFolder,
        Utilities.formatDate(dateObj, timezone, "MM"),
      );
      return getSubFolder(
        monthFolder,
        Utilities.formatDate(dateObj, timezone, "dd"),
      );
    } catch (e) {
      console.error("Folder Error:", e);
      try {
        return DriveApp.getFolderById(rootFolderId);
      } catch (ex) {
        return null;
      }
    }
  }

  // ✅ Helper: อัปโหลดรูปภาพเดี่ยว
  function _uploadImage(base64, mimeType, fileName, dateObj) {
    const imgFolderId = typeof CONFIG !== "undefined" ? CONFIG.IMG_FOLDER : "";
    if (!base64 || !imgFolderId) return "";
    try {
      const folder = _getOrCreateDateFolder(imgFolderId, dateObj);
      if (!folder) return "";
      const blob = Utilities.newBlob(
        Utilities.base64Decode(base64),
        mimeType,
        fileName,
      );
      const file = folder.createFile(blob);
      file.setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW,
      );
      return file.getUrl();
    } catch (e) {
      console.error("Upload Error:", e);
      return "";
    }
  }

  // ✅ Helper: Process Image Array (Mix of Base64 and Existing URLs)
  function _processImageArray(imageItems, id, suffix, dateObj) {
    if (!Array.isArray(imageItems) || imageItems.length === 0) return [];

    return imageItems
      .map((item, index) => {
        // 1. ถ้าเป็น URL เดิม ให้คืนค่ากลับไปเลย
        if (item.type === "url") return item.data;

        // 2. ถ้าเป็น Base64 ให้ทำการ Upload
        if (item.type === "base64") {
          const timestamp = Utilities.formatDate(
            new Date(),
            typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok",
            "HHmmss",
          );
          const fileName = `Match_${id}_${suffix}_${index}_${timestamp}.jpg`;
          return _uploadImage(item.data, "image/jpeg", fileName, dateObj);
        }
        return null;
      })
      .filter((url) => url && url !== ""); // กรองค่าว่างทิ้ง
  }

  // ✅ Helper: Safe JSON Parse for Image Columns
  function _parseImageCell(cellValue) {
    if (!cellValue) return "";
    const str = String(cellValue).trim();
    // ถ้าเริ่มด้วย [ แสดงว่าเป็น JSON Array (Multiple Images)
    if (str.startsWith("[") && str.endsWith("]")) {
      try {
        return JSON.parse(str);
      } catch (e) {
        return str; // Parse Error -> Return string
      }
    }
    // ถ้าไม่ใช่ JSON (Legacy Single Image)
    return str;
  }

  return {
    // =================================================================
    // ⚡ LIGHTWEIGHT POLLING (No Quota Waste)
    // =================================================================
    apiCheckMatchUpdate: function (clientLastSyncTime) {
      try {
        const dbId = getDbId();
        const lastUpdate = CacheService.getScriptCache().get(
          `MATCH_UPDATE_${dbId}`,
        );
        if (!lastUpdate) return Response.success(true);

        const hasUpdate = Number(lastUpdate) > Number(clientLastSyncTime);
        return Response.success(hasUpdate);
      } catch (e) {
        return Response.error(e.toString());
      }
    },

    _triggerMatchUpdate: function () {
      try {
        CacheService.getScriptCache().put(
          `MATCH_UPDATE_${getDbId()}`,
          Date.now().toString(),
          21600,
        ); // เก็บไว้ 6 ชั่วโมง
      } catch (e) {}
    },

    // =================================================================
    // 📋 GET WORK LIST (Dashboard Data)
    // =================================================================
    apiGetWorkList: function (forceRefresh) {
      try {
        const rawData = SheetService.getAll(
          getSheetName(),
          600,
          getDbId(),
          forceRefresh,
        );
        if (!rawData || rawData.length < 2) return Response.success([]);

        const headers = rawData[0];
        const getIdx = (keywords) =>
          headers.findIndex((h) =>
            keywords.some((k) =>
              String(h).toLowerCase().includes(k.toLowerCase()),
            ),
          );

        const idx = {
          id: getIdx(["Match ID", "ID"]),
          date: getIdx(["Date", "วันที่"]),
          time: getIdx(["Time", "Kickoff", "เวลา"]),
          league: getIdx(["League", "Program", "รายการ"]),
          home: getIdx(["Home", "Team 1", "เจ้าบ้าน"]),
          away: getIdx(["Away", "Team 2", "ทีมเยือน"]),
          channel: getIdx(["Channel", "ช่อง"]),
          status: getIdx(["Status", "สถานะ"]),
          startImg: getIdx(["Start Image", "Start", "Image In"]),
          stopImg: getIdx(["Stop Image", "Stop", "Image Out"]),
        };

        const matches = rawData.slice(1).map((row, i) => {
          const dateStr = _parseDate(row[idx.date]);
          let rowId = idx.id > -1 && row[idx.id] ? row[idx.id] : "";
          if (!rowId && dateStr) {
            rowId = `AUTO_${dateStr.replace(/-/g, "")}_${i}`;
          }

          return {
            id: rowId,
            date: dateStr,
            time: _parseTime(row[idx.time]),
            league: idx.league > -1 ? row[idx.league] || "" : "",
            home: idx.home > -1 ? row[idx.home] || "?" : "?",
            away: idx.away > -1 ? row[idx.away] || "?" : "?",
            channel: idx.channel > -1 ? row[idx.channel] || "-" : "-",
            status: idx.status > -1 ? row[idx.status] || "WAIT" : "WAIT",
            start_img:
              idx.startImg > -1 ? _parseImageCell(row[idx.startImg]) : "",
            stop_img: idx.stopImg > -1 ? _parseImageCell(row[idx.stopImg]) : "",
          };
        });

        const validMatches = matches.filter(
          (m) => m.date && m.date.length === 10,
        );
        validMatches.sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return a.time.localeCompare(b.time);
        });

        return Response.success(validMatches);
      } catch (e) {
        return Response.error("GetWorkList Error: " + e.toString());
      }
    },

    // =================================================================
    // ➕ CREATE WORK ITEM
    // =================================================================
    apiCreateWorkItem: function (data) {
      try {
        const newId = "M" + Date.now();
        const matchDate = data.date ? new Date(data.date) : new Date();
        const tz =
          typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
        const dateStr = Utilities.formatDate(matchDate, tz, "yyyy-MM-dd");

        let imageUrls = [];
        if (
          data.startImages &&
          Array.isArray(data.startImages) &&
          data.startImages.length > 0
        ) {
          imageUrls = _processImageArray(
            data.startImages,
            newId,
            "START",
            matchDate,
          );
        } else if (data.imageBase64) {
          const fileName = `Match_${newId}_START_Legacy.jpg`;
          const url = _uploadImage(
            data.imageBase64,
            data.mimeType || "image/jpeg",
            fileName,
            matchDate,
          );
          if (url) imageUrls.push(url);
        }

        const sheetName = getSheetName();
        const dbId = getDbId();
        const rawData = SheetService.getAll(sheetName, 0, dbId);
        const headers = rawData[0];
        const newRow = new Array(headers.length).fill("");

        const setVal = (keywords, val) => {
          const i = headers.findIndex((h) =>
            keywords.some((k) =>
              String(h).toLowerCase().includes(k.toLowerCase()),
            ),
          );
          if (i !== -1) newRow[i] = val;
        };

        setVal(["Match ID", "ID"], newId);
        setVal(["Date", "วันที่"], dateStr);
        setVal(["Time", "Kickoff", "เวลา"], data.time || "00:00");
        setVal(["League", "Program"], data.league || "Manual");
        setVal(["Home"], data.home || "?");
        setVal(["Away"], data.away || "?");
        setVal(["Channel"], data.channel || "Manual");

        const status = imageUrls.length > 0 ? "LIVE" : "WAIT";
        setVal(["Status", "สถานะ"], status);

        if (imageUrls.length > 0) {
          const valToSave =
            imageUrls.length > 1 ? JSON.stringify(imageUrls) : imageUrls[0];
          setVal(["Start Image", "Image In", "Start"], valToSave);
        }

        const tsIdx = headers.findIndex((h) =>
          h.toLowerCase().includes("timestamp"),
        );
        if (tsIdx > -1) newRow[tsIdx] = new Date();

        const success = SheetService.add(sheetName, newRow, dbId);
        if (success) this._triggerMatchUpdate(); // ✨ Trigger Polling Update

        return success
          ? Response.success({ message: "Created", id: newId })
          : Response.error("Save Failed");
      } catch (e) {
        return Response.error("Create Error: " + e.toString());
      }
    },

    // =================================================================
    // ⏹️ STOP WORK ITEM
    // =================================================================
    apiStopWorkItem: function (data) {
      try {
        if (!data.id) return Response.error("Missing ID");
        const today = new Date();

        let imageUrls = [];
        if (
          data.stopImages &&
          Array.isArray(data.stopImages) &&
          !data.isSkipImage
        ) {
          imageUrls = _processImageArray(
            data.stopImages,
            data.id,
            "STOP",
            today,
          );
        } else if (data.imageBase64 && !data.isSkipImage) {
          const fileName = `Match_${data.id}_STOP_Legacy.jpg`;
          const url = _uploadImage(
            data.imageBase64,
            data.mimeType || "image/jpeg",
            fileName,
            today,
          );
          if (url) imageUrls.push(url);
        }

        const updateMap = { Status: "DONE" };

        if (imageUrls.length > 0) {
          const valToSave =
            imageUrls.length > 1 ? JSON.stringify(imageUrls) : imageUrls[0];
          updateMap["Stop Image"] = valToSave;
          updateMap["Image Out"] = valToSave;
        }

        const success = SheetService.update(
          getSheetName(),
          data.id,
          updateMap,
          "Match ID",
          getDbId(),
        );
        if (success) this._triggerMatchUpdate(); // ✨ Trigger Polling Update

        return success
          ? Response.success({ message: "Stopped" })
          : Response.error("Update Failed");
      } catch (e) {
        return Response.error("Stop Error: " + e.toString());
      }
    },

    // =================================================================
    // ✏️ UPDATE WORK ITEM
    // =================================================================
    apiUpdateWorkItem: function (data) {
      try {
        if (!data.id) return Response.error("Missing ID");
        const updateMap = {
          Time: data.time,
          Kickoff: data.time,
          League: data.league,
          Program: data.league,
          Home: data.home,
          Away: data.away,
          Channel: data.channel,
          Date: data.date,
        };

        const targetDate = data.date ? new Date(data.date) : new Date();

        if (data.startImages && Array.isArray(data.startImages)) {
          const processed = _processImageArray(
            data.startImages,
            data.id,
            "START_Edit",
            targetDate,
          );
          if (processed.length > 0) {
            const val =
              processed.length > 1 ? JSON.stringify(processed) : processed[0];
            updateMap["Start Image"] = val;
            updateMap["Image In"] = val;
          } else {
            updateMap["Start Image"] = "";
            updateMap["Image In"] = "";
          }
        } else if (data.clearStartImage) {
          updateMap["Start Image"] = "";
          updateMap["Image In"] = "";
        } else if (data.startImageBase64) {
          const fileName = `Match_${data.id}_START_Edit.jpg`;
          const url = _uploadImage(
            data.startImageBase64,
            "image/jpeg",
            fileName,
            targetDate,
          );
          updateMap["Start Image"] = url;
          updateMap["Image In"] = url;
        }

        if (data.stopImages && Array.isArray(data.stopImages)) {
          const processed = _processImageArray(
            data.stopImages,
            data.id,
            "STOP_Edit",
            targetDate,
          );
          if (processed.length > 0) {
            const val =
              processed.length > 1 ? JSON.stringify(processed) : processed[0];
            updateMap["Stop Image"] = val;
            updateMap["Image Out"] = val;
          } else {
            updateMap["Stop Image"] = "";
            updateMap["Image Out"] = "";
          }
        } else if (data.clearStopImage) {
          updateMap["Stop Image"] = "";
          updateMap["Image Out"] = "";
        } else if (data.stopImageBase64) {
          const fileName = `Match_${data.id}_STOP_Edit.jpg`;
          const url = _uploadImage(
            data.stopImageBase64,
            "image/jpeg",
            fileName,
            targetDate,
          );
          updateMap["Stop Image"] = url;
          updateMap["Image Out"] = url;
        }

        const success = SheetService.update(
          getSheetName(),
          data.id,
          updateMap,
          "Match ID",
          getDbId(),
        );
        if (success) this._triggerMatchUpdate(); // ✨ Trigger Polling Update

        return success
          ? Response.success({ message: "Updated" })
          : Response.error("Update Failed");
      } catch (e) {
        return Response.error("Update Error: " + e.toString());
      }
    },

    // =================================================================
    // 🗑️ DELETE WORK ITEM
    // =================================================================
    apiDeleteWorkItem: function (id) {
      try {
        if (!id) return Response.error("Missing ID");
        const success = SheetService.delete(
          getSheetName(),
          id,
          "Match ID",
          getDbId(),
        );
        if (success) this._triggerMatchUpdate(); // ✨ Trigger Polling Update

        return success
          ? Response.success({ message: "Deleted" })
          : Response.error("Delete Failed");
      } catch (e) {
        return Response.error("Delete Error: " + e.toString());
      }
    },

    // =================================================================
    // 📅 GET CALENDAR EVENTS
    // =================================================================
    apiGetCalendarEvents: function (dateStr) {
      try {
        if (!dateStr) return Response.error("Missing Date");

        const sheetName = getSheetName();
        const dbId = getDbId();
        const rawData = SheetService.getAll(sheetName, 600, dbId);
        const existingKeys = new Set();

        if (rawData && rawData.length > 1) {
          const headers = rawData[0];
          const getIdx = (keywords) =>
            headers.findIndex((h) =>
              keywords.some((k) =>
                String(h).toLowerCase().includes(k.toLowerCase()),
              ),
            );
          const idxDate = getIdx(["Date", "วันที่"]);
          const idxTime = getIdx(["Time", "Kickoff", "เวลา"]);
          const idxHome = getIdx(["Home", "Team 1", "เจ้าบ้าน"]);

          rawData.slice(1).forEach((row) => {
            const rDate = _parseDate(row[idxDate]);
            const rTime = _parseTime(row[idxTime]);
            const rHome = (row[idxHome] || "").trim().toLowerCase();
            if (rDate === dateStr) {
              existingKeys.add(`${rDate}|${rTime}|${rHome}`);
            }
          });
        }

        let calendars =
          typeof CONFIG !== "undefined" ? CONFIG.GET_CALENDARS() : [];
        if (!calendars || calendars.length === 0)
          calendars = CalendarApp.getAllCalendars().map((c) => ({
            id: c.getId(),
            name: c.getName(),
          }));

        const tz =
          typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
        const d = new Date(dateStr);
        const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const endDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

        let events = [];
        calendars.forEach((calConfig) => {
          try {
            const cal = CalendarApp.getCalendarById(calConfig.id);
            if (!cal) return;
            cal.getEvents(startDay, endDay).forEach((evt) => {
              const evtStart = evt.getStartTime();
              const isPreviousDay = evtStart < startDay;
              const title = evt.getTitle();
              const desc = evt.getDescription() || "";
              let home = title,
                away = "",
                league = calConfig.name,
                channel = "N/A";

              const chMatch =
                desc.match(/Channel\s*:\s*([^)\n]+)/i) ||
                title.match(/Channel\s*:\s*([^)\n]+)/i);
              if (chMatch) channel = chMatch[1].trim();

              if (title.includes("vs")) {
                const parts = title.split("vs");
                home = parts[0].trim();
                away = parts[1].trim();
              }

              const timeStr = Utilities.formatDate(evtStart, tz, "HH:mm");
              const eventKey = `${dateStr}|${timeStr}|${home.trim().toLowerCase()}`;

              if (!existingKeys.has(eventKey)) {
                events.push({
                  time: timeStr,
                  league: league,
                  home: home,
                  away: away,
                  channel: channel,
                  fullTitle: title,
                  isPreviousDay: isPreviousDay,
                });
              }
            });
          } catch (err) {
            console.warn("Cal Error: " + calConfig.name);
          }
        });

        events.sort((a, b) => a.time.localeCompare(b.time));
        return Response.success(events);
      } catch (e) {
        return Response.error("Calendar Error: " + e.toString());
      }
    },
  };
})();
