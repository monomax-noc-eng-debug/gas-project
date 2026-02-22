/**
 * 🔄 Sync Calendar to Sheet (Best Practice: Smart Upsert)
 * ปรับปรุง:
 * 1. ใช้ Composite Key (Date + Team) เพื่อจับคู่รายการที่ ID ไม่ตรงกัน
 * 2. ใช้ Batch Operation อ่าน/เขียน ครั้งเดียวเพื่อความเร็ว
 * 3. ส่ง Return ค่ากลับไป Frontend เพื่อแก้ปัญหา Log Fail
 * 4. ✨ Trigger Match Update Flag สำหรับหน้า Dashboard (Lightweight Polling)
 */

function syncCalendarToSheet() {
  console.log("⏰ Sync Calendar Started...");
  const calendars = CONFIG.GET_CALENDARS();

  // 1. Validation: ถ้าไม่มี Config ให้แจ้ง Error กลับทันที
  if (!calendars || !calendars.length) {
    console.error("❌ No calendars config found");
    return { success: false, message: "ไม่พบการตั้งค่า Calendar (CONFIG)" };
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1); // เริ่มต้นเดือนนี้
  const endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0); // ล่วงหน้า 2 เดือน

  let allEvents = [];

  // 2. Fetch Events: ดึงข้อมูลจากทุก Calendar
  calendars.forEach((calConf) => {
    try {
      if (!calConf.id) return;
      const cal = CalendarApp.getCalendarById(calConf.id);

      if (cal) {
        const events = cal.getEvents(startDate, endDate);
        console.log(`[Sync] ${calConf.name}: Found ${events.length} events`);

        events.forEach((evt) => {
          allEvents.push({
            id: evt.getId(),
            league: calConf.name,
            title: evt.getTitle(),
            start: evt.getStartTime(),
            desc: evt.getDescription() || "",
          });
        });
      } else {
        console.warn(`[Sync] Calendar not found: ${calConf.id}`);
      }
    } catch (e) {
      console.error(`[Sync] Error fetching ${calConf.name}: ${e.toString()}`);
    }
  });

  // 3. Process & Save: ส่งข้อมูลไปประมวลผลและบันทึก
  return saveMatchesToDB(allEvents);
}

/**
 * 💾 Save Matches to DB (Smart Upsert)
 * บันทึกข้อมูลลง Sheet โดยตรวจสอบ ID และ วันที่+ชื่อทีม เพื่อป้องกันข้อมูลซ้ำ
 */
function saveMatchesToDB(events) {
  const sheet = _getSheet("DB_Matches");
  if (!sheet) return { success: false, message: "ไม่พบ Sheet 'DB_Matches'" };

  // 1. อ่านข้อมูลทั้งหมด (Batch Read)
  const dataRange = sheet.getDataRange();
  let data = dataRange.getValues();

  // สร้าง Header หากยังไม่มีข้อมูล
  if (data.length === 0) {
    data = [
      [
        "Match ID",
        "Date",
        "Time",
        "League",
        "Home",
        "Away",
        "Channel",
        "Signal",
        "Status",
        "Image In",
        "Image Out",
      ],
    ];
  }
  const headers = data[0];

  // 2. Map Column Index (ค้นหาตำแหน่งคอลัมน์อัตโนมัติ)
  const getIdx = (name) => headers.indexOf(name);
  const COL = {
    ID: getIdx("Match ID"),
    DATE: getIdx("Date"),
    TIME: getIdx("Time"),
    LEAGUE: getIdx("League"),
    HOME: getIdx("Home"),
    AWAY: getIdx("Away"),
    CHANNEL: getIdx("Channel"),
    STATUS: getIdx("Status"),
    SIGNAL: getIdx("Signal"),
  };

  // Validation: ตรวจสอบคอลัมน์สำคัญ
  if (COL.ID === -1 || COL.DATE === -1) {
    return { success: false, message: "คอลัมน์ Match ID หรือ Date หายไป" };
  }

  // 3. สร้าง Index เพื่อค้นหาข้อมูลเก่า (Smart Matching Map)
  const idMap = new Map(); // ค้นหาด้วย ID (Google ID)
  const signatureMap = new Map(); // ค้นหาด้วย "วันที่_ทีมเหย้า_ทีมเยือน"

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[COL.ID]);

    // 3.1 Map ID เดิม
    if (id) idMap.set(id, i);

    // 3.2 Map Signature (สำหรับจับคู่รายการที่สร้างเอง Manual)
    if (COL.DATE > -1 && COL.HOME > -1 && COL.AWAY > -1) {
      const dStr = normalizeDateISO(row[COL.DATE]);
      const home = normalizeTeamName(row[COL.HOME]);
      const away = normalizeTeamName(row[COL.AWAY]);

      if (dStr && home && away) {
        const signature = `${dStr}_${home}_${away}`;
        // เก็บ index แรกที่เจอ (ถ้ามีซ้ำ)
        if (!signatureMap.has(signature)) signatureMap.set(signature, i);
      }
    }
  }

  // 4. ประมวลผลข้อมูล (Update or Insert)
  let updateCount = 0;
  let insertCount = 0;
  const processedIndices = new Set(); // กันการแก้ไขแถวเดิมซ้ำในรอบเดียว

  events.forEach((evt) => {
    // เตรียมข้อมูลใหม่
    const googleId = evt.id;
    const dateStr = Utilities.formatDate(
      evt.start,
      CONFIG.TIMEZONE,
      "yyyy-MM-dd",
    );
    const timeStr = Utilities.formatDate(evt.start, CONFIG.TIMEZONE, "HH:mm");

    let channel = "-";
    const m = evt.desc.match(/Channel\s*:\s*([^\n]+)/i); // ดึงช่องจาก Description
    if (m) channel = m[1].trim();

    const teams = evt.title.split(/\s*v.?s.?\s*/i);
    const homeName = (teams[0] || evt.title).trim();
    const awayName = (teams[1] || "-").trim();

    // สร้าง Signature ของ Event ปัจจุบัน
    const currentSig = `${dateStr}_${normalizeTeamName(homeName)}_${normalizeTeamName(awayName)}`;

    // 🔥 LOGIC การจับคู่
    let rowIndex = -1;

    if (idMap.has(googleId)) {
      rowIndex = idMap.get(googleId); // เจอ ID ตรงกัน (เคย Sync แล้ว)
    } else if (signatureMap.has(currentSig)) {
      rowIndex = signatureMap.get(currentSig); // เจอทีม+วันที่ตรงกัน (เคยสร้าง Manual)
      // *Tip: อัปเดต ID ใน Sheet ให้เป็น Google ID เพื่อการ Sync ครั้งหน้า
      data[rowIndex][COL.ID] = googleId;
    }

    if (rowIndex > -1) {
      // ✅ UPDATE (แก้ไขแถวเดิม)
      if (!processedIndices.has(rowIndex)) {
        const row = data[rowIndex];

        // อัปเดตเฉพาะข้อมูลจาก Calendar (วันที่, เวลา, ลีก, ช่อง)
        if (COL.DATE > -1) row[COL.DATE] = dateStr;
        if (COL.TIME > -1) row[COL.TIME] = timeStr;
        if (COL.LEAGUE > -1) row[COL.LEAGUE] = evt.league;
        if (COL.HOME > -1) row[COL.HOME] = homeName;
        if (COL.AWAY > -1) row[COL.AWAY] = awayName;
        if (COL.CHANNEL > -1) row[COL.CHANNEL] = channel;

        // *ไม่* ทับ Status/Signal เดิม หากมีค่าอยู่แล้ว
        if (COL.STATUS > -1 && !row[COL.STATUS]) row[COL.STATUS] = "WAIT";
        if (COL.SIGNAL > -1 && !row[COL.SIGNAL]) row[COL.SIGNAL] = "NON";

        processedIndices.add(rowIndex);
        updateCount++;
      }
    } else {
      // ✅ INSERT (เพิ่มแถวใหม่)
      const newRow = new Array(headers.length).fill("");

      // ใส่ข้อมูลใหม่ลงตาม Index
      if (COL.ID > -1) newRow[COL.ID] = googleId;
      if (COL.DATE > -1) newRow[COL.DATE] = dateStr;
      if (COL.TIME > -1) newRow[COL.TIME] = timeStr;
      if (COL.LEAGUE > -1) newRow[COL.LEAGUE] = evt.league;
      if (COL.HOME > -1) newRow[COL.HOME] = homeName;
      if (COL.AWAY > -1) newRow[COL.AWAY] = awayName;
      if (COL.CHANNEL > -1) newRow[COL.CHANNEL] = channel;
      if (COL.STATUS > -1) newRow[COL.STATUS] = "WAIT";
      if (COL.SIGNAL > -1) newRow[COL.SIGNAL] = "NON";

      data.push(newRow);
      insertCount++;
    }
  });

  // 5. บันทึกข้อมูลกลับลง Sheet (Batch Write)
  if (updateCount > 0 || insertCount > 0) {
    // Sort ข้อมูลตามวันที่และเวลา
    const headerRow = data[0];
    const bodyRows = data.slice(1);

    bodyRows.sort((a, b) => {
      const dateA = String(a[COL.DATE]);
      const dateB = String(b[COL.DATE]);
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return String(a[COL.TIME]).localeCompare(String(b[COL.TIME]));
    });

    const finalData = [headerRow, ...bodyRows];

    // เขียนทับทั้งหมด (วิธีนี้ปลอดภัยและเร็วที่สุดสำหรับข้อมูล < 5000 แถว)
    sheet
      .getRange(1, 1, finalData.length, finalData[0].length)
      .setValues(finalData);

    // ✨ แจ้งเตือนระบบ Dashboard ว่ามีรายการอัปเดตใหม่ (Lightweight Polling)
    try {
      const dbId =
        typeof CONFIG !== "undefined"
          ? CONFIG.DB_ID
          : PropertiesService.getScriptProperties().getProperty(
              "CORE_SHEET_ID",
            );
      CacheService.getScriptCache().put(
        `MATCH_UPDATE_${dbId}`,
        Date.now().toString(),
        21600,
      );
    } catch (e) {
      console.warn("Match Update Trigger Failed", e);
    }
  }

  console.log(
    `✅ Sync Complete: Updated ${updateCount}, Inserted ${insertCount}`,
  );

  // ส่งผลลัพธ์กลับไปให้ Frontend
  return {
    success: true,
    message: `Sync Complete: Updated ${updateCount}, Inserted ${insertCount}`,
    log: [`Updated: ${updateCount}`, `New: ${insertCount}`],
  };
}

// --- Helper Functions ---

// แปลงวันที่เป็น String YYYY-MM-DD
function normalizeDateISO(val) {
  if (val instanceof Date)
    return Utilities.formatDate(val, CONFIG.TIMEZONE, "yyyy-MM-dd");
  if (!val) return "";
  return String(val).split(" ")[0];
}

// แปลงชื่อทีมให้เป็นมาตรฐาน (ตัวเล็ก, ตัดช่องว่าง)
function normalizeTeamName(name) {
  if (!name) return "";
  return String(name).toLowerCase().replace(/\s+/g, "");
}

/**
 * Alias for frontend compatibility (Settings page calls this function name)
 */
function runDailyAutoJob() {
  return syncCalendarToSheet();
}
