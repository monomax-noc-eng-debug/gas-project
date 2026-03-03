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

  // ✅ Helper: Resolve actual header name from fuzzy keywords
  function _resolveHeader(headers, keywords) {
    if (!headers || !Array.isArray(headers)) return null;
    return headers.find(h =>
      keywords.some(k => String(h).toLowerCase().includes(k.toLowerCase()))
    );
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
      } catch (e) { }
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
        const getIdx = (keywords, exact = false) =>
          headers.findIndex((h) =>
            keywords.some((k) => {
              const head = String(h).toLowerCase().trim();
              const target = k.toLowerCase().trim();
              return exact ? head === target : head.includes(target);
            }),
          );

        const idx = {
          id: getIdx(["Match ID", "ID"], true),
          date: getIdx(["Date", "วันที่"], true),
          time: getIdx(["Time", "Kickoff", "เวลา"], true),
          league: getIdx(["League", "Program", "รายการ"], true),
          home: getIdx(["Home", "Team 1", "เจ้าบ้าน"], true),
          away: getIdx(["Away", "Team 2", "ทีมเยือน"], true),
          channel: getIdx(["Channel", "ช่อง"], true),
          status: getIdx(["Status", "สถานะ"], true),
          startMono: getIdx(["Start Mono"], true),
          stopMono: getIdx(["Stop Mono"], true),
          startAis: getIdx(["Start AIS"], true),
          stopAis: getIdx(["Stop AIS"], true),
          // Legacy fallback - exact match only for "Start" or "Stop" to avoid matching "Start Mono"
          startImg: getIdx(["Start Image", "Start"], true),
          stopImg: getIdx(["Stop Image", "Stop"], true),
          checklist: getIdx(["Checklist", "รายการตรวจสอบ"], false),
        };

        // Second pass: if some critical headers not found, try fuzzy
        if (idx.date === -1) idx.date = getIdx(["Date", "วันที่"]);
        if (idx.time === -1) idx.time = getIdx(["Time", "เวลา"]);
        if (idx.status === -1) idx.status = getIdx(["Status", "สถานะ"]);

        const matches = rawData.slice(1).map((row, i) => {
          const dateStr = _parseDate(row[idx.date]);
          let rowId = idx.id > -1 && row[idx.id] ? row[idx.id] : "";
          if (!rowId && dateStr) {
            rowId = `AUTO_${dateStr.replace(/-/g, "")}_${i}`;
          }

          // Helper to get image data safely
          const getImgs = (colIdx) => colIdx > -1 ? _parseImageCell(row[colIdx]) : "";
          const toArr = (val) => {
            if (!val) return [];
            const arr = Array.isArray(val) ? val : [val];
            return arr.filter(u => u && String(u).trim().startsWith("http"));
          };

          const sMono = getImgs(idx.startMono);
          const sAis = getImgs(idx.startAis);
          const eMono = getImgs(idx.stopMono);
          const eAis = getImgs(idx.stopAis);

          // AGGREGATE ALL IMAGES for combined view (Thumbnail + N)
          const startAll = [...toArr(sMono), ...toArr(sAis)];
          // Fallback to legacy if both new columns are empty
          if (startAll.length === 0 && idx.startImg > -1) {
            startAll.push(...toArr(getImgs(idx.startImg)));
          }

          const stopAll = [...toArr(eMono), ...toArr(eAis)];
          if (stopAll.length === 0 && idx.stopImg > -1) {
            stopAll.push(...toArr(getImgs(idx.stopImg)));
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
            start_mono: sMono,
            stop_mono: eMono,
            start_ais: sAis,
            stop_ais: eAis,
            start_img: startAll, // UI uses this for thumbnail + count
            stop_img: stopAll,    // UI uses this for thumbnail + count
            checklist: idx.checklist > -1 ? _parseImageCell(row[idx.checklist]) : []
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

        // Process 4 image types
        const imgTypes = ['startMono', 'startAis', 'stopMono', 'stopAis'];
        const processed = {};
        imgTypes.forEach(type => {
          if (data[type] && Array.isArray(data[type]) && data[type].length > 0) {
            processed[type] = _processImageArray(data[type], newId, type.toUpperCase(), matchDate);
          } else {
            processed[type] = [];
          }
        });

        // Legacy fallback
        if (processed.startMono.length === 0 && data.startImages && Array.isArray(data.startImages) && data.startImages.length > 0) {
          processed.startMono = _processImageArray(data.startImages, newId, "START_MONO", matchDate);
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

        const hasAnyImg = processed.startMono.length > 0 || processed.startAis.length > 0;
        const status = hasAnyImg ? "LIVE" : "WAIT";
        setVal(["Status", "สถานะ"], status);

        // Save 4 image columns
        const saveImgCol = (colNames, urls) => {
          if (urls.length > 0) {
            const val = urls.length > 1 ? JSON.stringify(urls) : urls[0];
            setVal(colNames, val);
          }
        };
        saveImgCol(["Start Mono"], processed.startMono);
        saveImgCol(["Stop Mono"], processed.stopMono);
        saveImgCol(["Start AIS"], processed.startAis);
        saveImgCol(["Stop AIS"], processed.stopAis);

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
        const sheetName = getSheetName();
        const dbId = getDbId();

        // Resolve headers once
        const headers = SheetService.getAll(sheetName, 0, dbId)[0];
        const resolve = (keys) => _resolveHeader(headers, keys);

        const idCol = resolve(["Match ID", "ID"]);
        const statusCol = resolve(["Status", "สถานะ"]);
        const stopMonoCol = resolve(["Stop Mono"]);
        const stopAisCol = resolve(["Stop AIS"]);

        if (!statusCol) return Response.error("Status column not found");

        const updateMap = {};
        updateMap[statusCol] = "DONE";

        if (!data.isSkipImage) {
          const stopTypes = [
            { key: 'stopMono', col: stopMonoCol, suffix: 'STOP_MONO' },
            { key: 'stopAis', col: stopAisCol, suffix: 'STOP_AIS' }
          ];

          stopTypes.forEach(({ key, col, suffix }) => {
            if (col && data[key] && Array.isArray(data[key]) && data[key].length > 0) {
              const urls = _processImageArray(data[key], data.id, suffix, today);
              if (urls.length > 0) {
                updateMap[col] = urls.length > 1 ? JSON.stringify(urls) : urls[0];
              }
            }
          });

          // Legacy fallback
          if (!data.stopMono && data.stopImages && Array.isArray(data.stopImages) && data.stopImages.length > 0 && stopMonoCol) {
            const urls = _processImageArray(data.stopImages, data.id, "STOP_MONO", today);
            if (urls.length > 0) {
              updateMap[stopMonoCol] = urls.length > 1 ? JSON.stringify(urls) : urls[0];
            }
          }
        }

        const success = SheetService.update(
          sheetName,
          data.id,
          updateMap,
          idCol || "Match ID",
          dbId
        );
        if (success) this._triggerMatchUpdate();

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
        const sheetName = getSheetName();
        const dbId = getDbId();
        const headers = SheetService.getAll(sheetName, 0, dbId)[0];
        const resolve = (keys) => _resolveHeader(headers, keys);

        const idCol = resolve(["Match ID", "ID"]);
        const updateMap = {};

        const mappings = [
          { keys: ["Time", "Kickoff", "เวลา"], val: data.time },
          { keys: ["League", "Program", "รายการ"], val: data.league },
          { keys: ["Home", "เจ้าบ้าน"], val: data.home },
          { keys: ["Away", "ทีมเยือน"], val: data.away },
          { keys: ["Channel", "ช่อง"], val: data.channel },
          { keys: ["Date", "วันที่"], val: data.date }
        ];

        mappings.forEach(m => {
          const col = resolve(m.keys);
          if (col) updateMap[col] = m.val;
        });

        const targetDate = data.date ? new Date(data.date) : new Date();

        const editImgTypes = [
          { key: 'startMono', colKeys: ['Start Mono'], suffix: 'START_MONO_Edit' },
          { key: 'startAis', colKeys: ['Start AIS'], suffix: 'START_AIS_Edit' },
          { key: 'stopMono', colKeys: ['Stop Mono'], suffix: 'STOP_MONO_Edit' },
          { key: 'stopAis', colKeys: ['Stop AIS'], suffix: 'STOP_AIS_Edit' },
        ];

        editImgTypes.forEach(({ key, colKeys, suffix }) => {
          const col = resolve(colKeys);
          if (col && data[key] && Array.isArray(data[key])) {
            const processed = _processImageArray(data[key], data.id, suffix, targetDate);
            // Only update if images are provided (don't clear if undefined)
            // But if array is empty, it means user removed all images
            updateMap[col] = processed.length > 0
              ? (processed.length > 1 ? JSON.stringify(processed) : processed[0])
              : "";
          }
        });

        // Legacy fallback
        if (!data.startMono && data.startImages && Array.isArray(data.startImages)) {
          const col = resolve(["Start Mono"]);
          if (col) {
            const processed = _processImageArray(data.startImages, data.id, "START_MONO_Edit", targetDate);
            updateMap[col] = processed.length > 0 ? (processed.length > 1 ? JSON.stringify(processed) : processed[0]) : "";
          }
        }

        const success = SheetService.update(
          sheetName,
          data.id,
          updateMap,
          idCol || "Match ID",
          dbId
        );
        if (success) this._triggerMatchUpdate();

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
        const sheetName = getSheetName();
        const dbId = getDbId();
        const headers = SheetService.getAll(sheetName, 0, dbId)[0];
        const idCol = _resolveHeader(headers, ["Match ID", "ID"]);

        const success = SheetService.delete(
          sheetName,
          id,
          idCol || "Match ID",
          dbId
        );
        if (success) this._triggerMatchUpdate();

        return success
          ? Response.success({ message: "Deleted" })
          : Response.error("Delete Failed");
      } catch (e) {
        return Response.error("Delete Error: " + e.toString());
      }
    },

    // =================================================================
    // ✅ SAVE CHECKLIST
    // =================================================================
    apiSaveChecklist: function (data) {
      try {
        if (!data.id) return Response.error("Missing ID");
        const sheetName = getSheetName();
        const dbId = getDbId();
        const headers = SheetService.getAll(sheetName, 0, dbId)[0];
        const resolve = (keys) => _resolveHeader(headers, keys);

        const idCol = resolve(["Match ID", "ID"]);
        let clCol = resolve(["Checklist", "รายการตรวจสอบ"]);

        if (!clCol) {
          const ss = SpreadsheetApp.openById(dbId);
          const sheet = ss.getSheetByName(sheetName);
          if (sheet) {
            const newColIndex = Math.max(sheet.getLastColumn() + 1, 1);
            sheet.getRange(1, newColIndex).setValue("Checklist");
            CacheService.getScriptCache().remove(`SHEET_DATA_${dbId}_${sheetName}`);
            clCol = "Checklist";
          } else {
            return Response.error("ไม่พบ Sheet " + sheetName);
          }
        }

        const updateMap = {};
        updateMap[clCol] = JSON.stringify(data.checklist);

        const success = SheetService.update(
          sheetName,
          data.id,
          updateMap,
          idCol || "Match ID",
          dbId
        );
        if (success) this._triggerMatchUpdate();

        return success
          ? Response.success({ message: "Checklist Saved" })
          : Response.error("Update Failed");
      } catch (e) {
        return Response.error("Save Checklist Error: " + e.toString());
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
