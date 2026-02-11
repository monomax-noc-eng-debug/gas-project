/**
 * src/backend/controllers/MatchController.js
 * จัดการข้อมูลงาน (Matches) และปฏิทิน
 * Version: Final Stable (Flexible Date/Headers & Robust Upload)
 */

const MatchController = (() => {
  // ✅ 1. Helper Functions (Lazy Load Config)
  const getDbId = () => (typeof CONFIG !== 'undefined') ? CONFIG.DB_ID : "";
  const getSheetName = () => (typeof CONFIG !== 'undefined') ? (CONFIG.MATCH_TAB || "DB_Matches") : "DB_Matches";

  // ✅ Helper: แปลงวันที่ให้รองรับทุกรูปแบบ (Date, String, "7 February 2026")
  function _parseDate(val) {
    if (!val) return "";
    const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";

    // กรณีเป็น Date Object อยู่แล้ว
    if (val instanceof Date) return Utilities.formatDate(val, tz, "yyyy-MM-dd");

    const strVal = String(val).trim();
    // ลองแปลงจาก String (รองรับภาษาอังกฤษ เช่น "7 February 2026")
    const d = new Date(strVal);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, tz, "yyyy-MM-dd");
    }
    // Fallback: ตัด String เอาเฉพาะส่วนหน้า (กรณี yyyy-MM-dd HH:mm)
    return strVal.split(' ')[0];
  }

  // ✅ Helper: แปลงเวลาให้เป็น HH:mm เสมอ
  function _parseTime(val) {
    if (!val) return "00:00";
    const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";

    // 1. กรณีเป็น Date Object
    if (val instanceof Date) return Utilities.formatDate(val, tz, "HH:mm");

    const strVal = String(val).trim();

    // 2. กรณีเป็น String Date (เช่น "1899-12-30T10:00:00.000Z" หรือ "Sat Dec 30 1899...")
    // ถ้าขึ้นต้นด้วยปี 4 หลัก หรือ มีรูปแบบวันที่
    if (strVal.match(/^\d{4}-\d{2}-\d{2}/) || strVal.includes("1899")) {
      const d = new Date(strVal);
      if (!isNaN(d.getTime())) {
        return Utilities.formatDate(d, tz, "HH:mm");
      }
    }

    // 3. กรณีเป็น Time String ทั่วไป (แปลงจุดเป็น colon เช่น 22.00 -> 22:00)
    let str = strVal.replace('.', ':');

    // เติม 0 ข้างหน้าถ้าจำเป็น (เช่น 9:00 -> 09:00)
    if (str.indexOf(':') === 1) str = '0' + str;

    // ตัดให้เหลือ 5 ตัวอักษร (HH:mm)
    return str.length > 5 ? str.substring(0, 5) : str;
  }

  // ✅ Helper: จัดการ Folder ตามวันที่ (Year/Month/Day)
  function _getOrCreateDateFolder(rootFolderId, dateObj) {
    try {
      if (!rootFolderId) return null;
      const root = DriveApp.getFolderById(rootFolderId);
      const timezone = (typeof CONFIG !== 'undefined' ? CONFIG.TIMEZONE : "Asia/Bangkok");

      const getSubFolder = (parent, name) => {
        const folders = parent.getFoldersByName(name);
        return folders.hasNext() ? folders.next() : parent.createFolder(name);
      };

      const yearFolder = getSubFolder(root, Utilities.formatDate(dateObj, timezone, "yyyy"));
      const monthFolder = getSubFolder(yearFolder, Utilities.formatDate(dateObj, timezone, "MM"));
      const dayFolder = getSubFolder(monthFolder, Utilities.formatDate(dateObj, timezone, "dd"));
      return dayFolder;
    } catch (e) {
      console.error("Folder Error:", e);
      // Fallback: ใช้ Root Folder แทนถ้าสร้างย่อยไม่ได้
      try { return DriveApp.getFolderById(rootFolderId); } catch (ex) { return null; }
    }
  }

  // ✅ Helper: อัปโหลดรูปภาพ
  function _uploadImage(base64, mimeType, fileName, dateObj) {
    const imgFolderId = (typeof CONFIG !== 'undefined') ? CONFIG.IMG_FOLDER : "";
    if (!base64 || !imgFolderId) return "";

    try {
      const folder = _getOrCreateDateFolder(imgFolderId, dateObj);
      if (!folder) return "";

      const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, fileName);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return file.getUrl();
    } catch (e) {
      console.error("Upload Error:", e);
      return "";
    }
  }

  return {
    // =================================================================
    // 📋 GET WORK LIST (Dashboard Data)
    // =================================================================
    apiGetWorkList: function () {
      try {
        const rawData = SheetService.getAll(getSheetName(), 600, getDbId());
        if (!rawData || rawData.length < 2) return Response.success([]);

        const headers = rawData[0];

        // Dynamic Header Mapping (ค้นหาด้วย Keyword หลายแบบ)
        const getIdx = (keywords) => headers.findIndex(h => keywords.some(k => String(h).toLowerCase().includes(k.toLowerCase())));

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
          stopImg: getIdx(["Stop Image", "Stop", "Image Out"])
        };

        const matches = rawData.slice(1).map((row, i) => {
          // 1. แปลงวันที่
          const dateStr = _parseDate(row[idx.date]);

          // 2. สร้าง Auto ID ถ้าไม่มี
          let rowId = (idx.id > -1 && row[idx.id]) ? row[idx.id] : "";
          if (!rowId && dateStr) {
            rowId = `AUTO_${dateStr.replace(/-/g, '')}_${i}`;
          }

          return {
            id: rowId,
            date: dateStr,
            time: _parseTime(row[idx.time]),
            league: (idx.league > -1) ? (row[idx.league] || "") : "",
            home: (idx.home > -1) ? (row[idx.home] || "?") : "?",
            away: (idx.away > -1) ? (row[idx.away] || "?") : "?",
            channel: (idx.channel > -1) ? (row[idx.channel] || "-") : "-",
            status: (idx.status > -1) ? (row[idx.status] || "WAIT") : "WAIT",
            start_img: (idx.startImg > -1) ? row[idx.startImg] : "",
            stop_img: (idx.stopImg > -1) ? row[idx.stopImg] : ""
          };
        });

        // Filter: เอาเฉพาะรายการที่มีวันที่ถูกต้อง (yyyy-MM-dd มี 10 ตัวอักษร)
        const validMatches = matches.filter(m => m.date && m.date.length === 10);

        // Sort: เรียงตามวันที่ -> เวลา
        validMatches.sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return a.time.localeCompare(b.time);
        });

        return Response.success(validMatches);
      } catch (e) { return Response.error("GetWorkList Error: " + e.toString()); }
    },

    // =================================================================
    // ➕ CREATE WORK ITEM
    // =================================================================
    apiCreateWorkItem: function (data) {
      try {
        const newId = "M" + Date.now();
        const matchDate = data.date ? new Date(data.date) : new Date();
        const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
        const dateStr = Utilities.formatDate(matchDate, tz, "yyyy-MM-dd");

        let imageUrl = "";
        if (data.imageBase64) {
          const fileName = `Match_${newId}_START_${Utilities.formatDate(new Date(), tz, "HHmmss")}.jpg`;
          imageUrl = _uploadImage(data.imageBase64, data.mimeType || "image/jpeg", fileName, matchDate);
        }

        const sheetName = getSheetName();
        const dbId = getDbId();
        const rawData = SheetService.getAll(sheetName, 0, dbId);
        const headers = rawData[0];
        const newRow = new Array(headers.length).fill("");

        const setVal = (keywords, val) => {
          const i = headers.findIndex(h => keywords.some(k => String(h).toLowerCase().includes(k.toLowerCase())));
          if (i !== -1) newRow[i] = val;
        };

        setVal(["Match ID", "ID"], newId);
        setVal(["Date", "วันที่"], dateStr);
        setVal(["Time", "Kickoff", "เวลา"], data.time || "00:00");
        setVal(["League", "Program"], data.league || "Manual");
        setVal(["Home"], data.home || "?");
        setVal(["Away"], data.away || "?");
        setVal(["Channel"], data.channel || "Manual");

        // Logic: มีรูป -> LIVE, ไม่มีรูป -> WAIT
        const status = imageUrl ? "LIVE" : "WAIT";
        setVal(["Status", "สถานะ"], status);

        if (imageUrl) {
          setVal(["Start Image", "Image In", "Start"], imageUrl);
        }

        // Timestamp
        const tsIdx = headers.findIndex(h => h.toLowerCase().includes("timestamp"));
        if (tsIdx > -1) newRow[tsIdx] = new Date();

        const success = SheetService.add(sheetName, newRow, dbId);
        return success ? Response.success({ message: "Created", id: newId }) : Response.error("Save Failed");
      } catch (e) { return Response.error("Create Error: " + e.toString()); }
    },

    // =================================================================
    // ⏹️ STOP WORK ITEM
    // =================================================================
    apiStopWorkItem: function (data) {
      try {
        if (!data.id) return Response.error("Missing ID");

        let imageUrl = "";
        if (data.imageBase64 && !data.isSkipImage) {
          const today = new Date();
          const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
          const fileName = `Match_${data.id}_STOP_${Utilities.formatDate(today, tz, "HHmmss")}.jpg`;
          imageUrl = _uploadImage(data.imageBase64, data.mimeType || "image/jpeg", fileName, today);
        }

        const updateMap = { "Status": "DONE" };

        // Update ทั้ง 2 ชื่อคอลัมน์เพื่อความชัวร์ (ถ้ามี)
        if (imageUrl) {
          updateMap["Stop Image"] = imageUrl;
          updateMap["Image Out"] = imageUrl;
        }

        const success = SheetService.update(getSheetName(), data.id, updateMap, "Match ID", getDbId());
        return success ? Response.success({ message: "Stopped", url: imageUrl }) : Response.error("Update Failed");
      } catch (e) { return Response.error("Stop Error: " + e.toString()); }
    },

    // =================================================================
    // ✏️ UPDATE WORK ITEM
    // =================================================================
    apiUpdateWorkItem: function (data) {
      try {
        if (!data.id) return Response.error("Missing ID");
        const updateMap = {
          "Time": data.time, "Kickoff": data.time,
          "League": data.league, "Program": data.league,
          "Home": data.home, "Away": data.away,
          "Channel": data.channel, "Date": data.date
        };

        const targetDate = data.date ? new Date(data.date) : new Date();

        if (data.startImageBase64) {
          const fileName = `Match_${data.id}_START_Edit.jpg`;
          const url = _uploadImage(data.startImageBase64, "image/jpeg", fileName, targetDate);
          updateMap["Start Image"] = url;
          updateMap["Image In"] = url;
        } else if (data.clearStartImage) {
          updateMap["Start Image"] = "";
          updateMap["Image In"] = "";
        }
        if (data.stopImageBase64) {
          const fileName = `Match_${data.id}_STOP_Edit.jpg`;
          const url = _uploadImage(data.stopImageBase64, "image/jpeg", fileName, targetDate);
          updateMap["Stop Image"] = url;
          updateMap["Image Out"] = url;
        } else if (data.clearStopImage) {
          updateMap["Stop Image"] = "";
          updateMap["Image Out"] = "";
        }

        const success = SheetService.update(getSheetName(), data.id, updateMap, "Match ID", getDbId());
        return success ? Response.success({ message: "Updated" }) : Response.error("Update Failed");
      } catch (e) { return Response.error("Update Error: " + e.toString()); }
    },

    // =================================================================
    // 🗑️ DELETE WORK ITEM
    // =================================================================
    apiDeleteWorkItem: function (id) {
      try {
        if (!id) return Response.error("Missing ID");
        const success = SheetService.delete(getSheetName(), id, "Match ID", getDbId());
        return success ? Response.success({ message: "Deleted" }) : Response.error("Delete Failed");
      } catch (e) { return Response.error("Delete Error: " + e.toString()); }
    },

    // =================================================================
    // 📅 GET CALENDAR EVENTS
    // =================================================================
    // =================================================================
    // 📅 GET CALENDAR EVENTS
    // =================================================================
    apiGetCalendarEvents: function (dateStr) {
      try {
        if (!dateStr) return Response.error("Missing Date");

        // 1. ดึงข้อมูลงานที่มีอยู่แล้วในระบบ (เพื่อกันซ้ำ)
        const sheetName = getSheetName();
        const dbId = getDbId();
        const rawData = SheetService.getAll(sheetName, 600, dbId);
        const existingKeys = new Set();

        if (rawData && rawData.length > 1) {
          const headers = rawData[0];
          const getIdx = (keywords) => headers.findIndex(h => keywords.some(k => String(h).toLowerCase().includes(k.toLowerCase())));
          const idxDate = getIdx(["Date", "วันที่"]);
          const idxTime = getIdx(["Time", "Kickoff", "เวลา"]);
          const idxHome = getIdx(["Home", "Team 1", "เจ้าบ้าน"]);

          rawData.slice(1).forEach(row => {
            const rDate = _parseDate(row[idxDate]);
            const rTime = _parseTime(row[idxTime]);
            const rHome = (row[idxHome] || "").trim().toLowerCase();
            // Key: yyyy-MM-dd|HH:mm|home_team
            if (rDate === dateStr) {
              existingKeys.add(`${rDate}|${rTime}|${rHome}`);
            }
          });
        }

        // 2. ดึงข้อมูลจาก Calendar
        let calendars = (typeof CONFIG !== 'undefined') ? CONFIG.GET_CALENDARS() : [];
        if (!calendars || calendars.length === 0) calendars = CalendarApp.getAllCalendars().map(c => ({ id: c.getId(), name: c.getName() }));

        const tz = (typeof CONFIG !== 'undefined' ? CONFIG.TIMEZONE : "Asia/Bangkok");
        const d = new Date(dateStr);
        const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const endDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

        let events = [];
        calendars.forEach(calConfig => {
          try {
            const cal = CalendarApp.getCalendarById(calConfig.id);
            if (!cal) return;
            cal.getEvents(startDay, endDay).forEach(evt => {
              const evtStart = evt.getStartTime();
              const isPreviousDay = evtStart < startDay;
              const title = evt.getTitle();
              const desc = evt.getDescription() || "";
              let home = title, away = "", league = calConfig.name, channel = "N/A";

              // Parse Description
              const chMatch = desc.match(/Channel\s*:\s*([^)\n]+)/i) || title.match(/Channel\s*:\s*([^)\n]+)/i);
              if (chMatch) channel = chMatch[1].trim();

              if (title.includes("vs")) {
                const parts = title.split("vs");
                home = parts[0].trim(); away = parts[1].trim();
              }

              const timeStr = Utilities.formatDate(evtStart, tz, "HH:mm");

              // 3. Filter Duplicates (Check against existing DB)
              // Key: yyyy-MM-dd|HH:mm|home_team
              const eventKey = `${dateStr}|${timeStr}|${home.trim().toLowerCase()}`;

              if (!existingKeys.has(eventKey)) {
                events.push({
                  time: timeStr,
                  league: league,
                  home: home,
                  away: away,
                  channel: channel,
                  fullTitle: title,
                  isPreviousDay: isPreviousDay
                });
              }
            });
          } catch (err) { console.warn("Cal Error: " + calConfig.name); }
        });

        events.sort((a, b) => a.time.localeCompare(b.time));
        return Response.success(events);
      } catch (e) { return Response.error("Calendar Error: " + e.toString()); }
    }
  };
})();