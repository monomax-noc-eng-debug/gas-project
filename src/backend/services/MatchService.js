/**
 * MatchService.js
 * จัดการข้อมูลการแข่งขัน สรุปผลลีก และการตรวจสอบรูปภาพหลักฐาน
 */
const MatchService = {
  /**
   * ดึงข้อมูลรายงานการตรวจสอบการแข่ง (สรุปลีก + ตารางคู่แข่งพร้อมรูป)
   * @param {string} dateStr - วันที่ต้องการดึงข้อมูล (yyyy-MM-dd)
   * @param {boolean} forceRefresh - บังคับล้าง Cache เพื่อดึงข้อมูลสดจากชีต
   */
  getVerificationReport: function (dateStr, forceRefresh = false) {
    const cache = CacheService.getScriptCache();
    const cacheKey = "match_report_v2_" + dateStr;

    // 🔍 1. ตรวจสอบใน Cache ก่อน (ยกเว้นมีการสั่ง forceRefresh)
    if (!forceRefresh) {
      const cachedData = cache.get(cacheKey);
      if (cachedData) {
        console.log("⚡ Match Report: Cache Hit for " + dateStr);
        return JSON.parse(cachedData);
      }
    } else {
      console.log("🔄 Match Report: Force Refresh - Clearing Cache");
      cache.remove(cacheKey);
    }

    try {
      const tz =
        typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
      const targetDateObj = dateStr ? new Date(dateStr) : new Date();
      const targetDateStr = Utilities.formatDate(
        targetDateObj,
        tz,
        "yyyy-MM-dd",
      );
      const prevDateObj = new Date(targetDateObj);
      prevDateObj.setDate(targetDateObj.getDate() - 1);
      const prevDateStr = Utilities.formatDate(prevDateObj, tz, "yyyy-MM-dd");

      // --- ส่วนที่ 1: ดึงข้อมูลจากชีต "Match End" (ข้อมูลหลัก) ---
      const statsId =
        typeof CONFIG !== "undefined"
          ? CONFIG.STATS_DB_ID
          : PropertiesService.getScriptProperties().getProperty("STATS_DB_ID");
      const statsTab =
        typeof CONFIG !== "undefined" ? CONFIG.STATS_TAB_NAME : "Match End";
      if (!statsId) return API_UTILS.createRes(false, "STATS_DB_ID missing");

      const ssExt = SpreadsheetApp.openById(statsId);
      const sheetExt = ssExt.getSheetByName(statsTab);
      const lastRowExt = sheetExt.getLastRow();
      const lastColExt = sheetExt.getLastColumn();

      if (lastRowExt < 2)
        return API_UTILS.createRes(true, {
          summary: {},
          list: [],
          stats: { totalMatches: 0 },
        });

      // ดึง Header มาเพื่อหาตำแหน่ง Column
      const headersExt = sheetExt.getRange(1, 1, 1, lastColExt).getValues()[0];
      const findColExt = (keys) =>
        headersExt.findIndex((h) =>
          keys.some((k) => String(h).toLowerCase().includes(k.toLowerCase())),
        );
      const idxExt = {
        date: findColExt(["date", "วันที่"]),
        time: findColExt(["time", "kickoff"]),
        league: findColExt(["league", "program"]),
        home: findColExt(["home", "team 1"]),
        away: findColExt(["away", "team 2"]),
        score: findColExt(["score", "ft", "ผล"]),
        channel: findColExt(["channel", "ช่อง", "tv"]),
      };

      // 🔥 เทคนิคเพิ่มความเร็ว: ดึงแค่ 1,000 บรรทัดล่าสุดจากก้นชีต
      const FETCH_LIMIT = 1000;
      const numRowsExt = Math.min(FETCH_LIMIT, lastRowExt - 1);
      const startRowExt = lastRowExt - numRowsExt + 1;
      const dataExt = sheetExt
        .getRange(startRowExt, 1, numRowsExt, lastColExt)
        .getValues();

      const uniqueMap = new Map();
      let leagueCounts = {};

      dataExt.forEach((row) => {
        const rDateStr = API_UTILS.formatDateTime(row[idxExt.date], "date");
        const rTimeStr = API_UTILS.formatDateTime(row[idxExt.time], "time");

        // กรองเฉพาะช่วงเวลา 10:00 เมื่อวาน ถึง 09:59 วันนี้
        if (
          (rDateStr === prevDateStr && rTimeStr >= "10:00") ||
          (rDateStr === targetDateStr && rTimeStr < "10:00")
        ) {
          const homeName = String(row[idxExt.home] || "").trim();
          const uniqueKey = `${rTimeStr}_${homeName.toLowerCase().replace(/\s/g, "")}`;

          if (!uniqueMap.has(uniqueKey)) {
            uniqueMap.set(uniqueKey, row);

            // สรุปจำนวนแยกตามกลุ่มลีก (Grouping Logic)
            let league = row[idxExt.league] || "Other";
            const lUpper = String(league).toUpperCase();
            let groupName = league;
            if (lUpper.includes("SV LEAGUE"))
              groupName = "SV League Volleyball";
            else if (lUpper.includes("THAI LEAGUE")) groupName = "Thai League";
            else if (lUpper.includes("FRENCH")) groupName = "French League";
            else if (lUpper.includes("PREMIER LEAGUE"))
              groupName = "Premier League";
            else if (lUpper.includes("EFL")) groupName = "EFL";

            leagueCounts[groupName] = (leagueCounts[groupName] || 0) + 1;
          }
        }
      });
      const filteredExt = Array.from(uniqueMap.values());

      // --- ส่วนที่ 2: ดึงข้อมูลจากชีต "DB_Matches" (เพื่อเอารูปหลักฐาน) ---
      const sheetDb = API_UTILS.getDbSheet();
      const lastRowDb = sheetDb.getLastRow();
      const lastColDb = sheetDb.getLastColumn();

      const headersDb = sheetDb.getRange(1, 1, 1, lastColDb).getValues()[0];
      const headerMapDb = {};
      headersDb.forEach((h, i) => {
        if (h) headerMapDb[String(h).toLowerCase().trim()] = i;
      });

      // ดึง 1,000 บรรทัดล่าสุดจากชีต DB เพื่อความเร็ว
      const numRowsDb = Math.min(FETCH_LIMIT, lastRowDb - 1);
      const dataDb =
        lastRowDb > 1
          ? sheetDb
            .getRange(lastRowDb - numRowsDb + 1, 1, numRowsDb, lastColDb)
            .getValues()
          : [];

      const norm = (str) =>
        String(str || "")
          .toLowerCase()
          .replace(/\s/g, "");

      // 🧠 สร้าง Hash Map (สารบัญ) สำหรับจับคู่รูปภาพ O(1) Speed
      const dbImageMap = new Map();
      const col = {
        date: headersDb.findIndex((h) => String(h).toLowerCase() === "date" || String(h).trim() === "วันที่"),
        time: headersDb.findIndex((h) => String(h).toLowerCase() === "time" || String(h).toLowerCase() === "kickoff" || String(h).trim() === "เวลา"),
        home: headersDb.findIndex((h) => String(h).toLowerCase() === "home" || String(h).toLowerCase() === "team 1" || String(h).trim() === "เจ้าบ้าน"),
        away: headersDb.findIndex((h) => String(h).toLowerCase() === "away" || String(h).toLowerCase() === "team 2" || String(h).trim() === "ทีมเยือน"),
        startMono: headersDb.findIndex((h) => String(h).trim() === "Start Mono"),
        stopMono: headersDb.findIndex((h) => String(h).trim() === "Stop Mono"),
        startAis: headersDb.findIndex((h) => String(h).trim() === "Start AIS"),
        stopAis: headersDb.findIndex((h) => String(h).trim() === "Stop AIS"),
        start: headersDb.findIndex((h) => String(h).trim() === "Start"),
        stop: headersDb.findIndex((h) => String(h).trim() === "Stop"),
        league: headersDb.findIndex((h) => String(h).toLowerCase() === "league" || String(h).toLowerCase() === "program"),
        channel: headersDb.findIndex((h) => String(h).trim() === "Channel" || String(h).trim() === "ช่อง"),
      };

      dataDb.forEach((rowDb) => {
        const hDb = norm(rowDb[col.home]);
        const aDb = norm(rowDb[col.away]);
        // เก็บสารบัญทั้งแบบเหย้า-เยือน และเยือน-เหย้า (กันพลาด)
        dbImageMap.set(`${hDb}_${aDb}`, rowDb);
        dbImageMap.set(`${aDb}_${hDb}`, rowDb);
      });

      // --- ส่วนที่ 3: รวมร่างข้อมูลเพื่อส่งกลับหน้าเว็บ ---
      let reportList = filteredExt.map((rowExt) => {
        const homeExt = String(rowExt[idxExt.home] || "").trim();
        const awayExt = String(rowExt[idxExt.away] || "").trim();
        const timeExt = API_UTILS.formatDateTime(rowExt[idxExt.time], "time");
        const dateExt = API_UTILS.formatDateTime(rowExt[idxExt.date], "date");
        const leagueExt = rowExt[idxExt.league] || "";
        const scoreExt = idxExt.score > -1 ? rowExt[idxExt.score] : "-";
        const channelExt = idxExt.channel > -1 ? rowExt[idxExt.channel] : "";

        // ค้นหารูปจากสารบัญ (ไม่ต้องวนลูปซ้อนลูป)
        const matchedDb = dbImageMap.get(`${norm(homeExt)}_${norm(awayExt)}`);

        let dbData = {
          date: dateExt,
          time: timeExt,
          home: homeExt,
          away: awayExt,
          league: leagueExt,
          start_mono: "",
          stop_mono: "",
          start_ais: "",
          stop_ais: "",
          channel: channelExt,
          startImg: "", // fallback
          stopImg: ""  // fallback
        };

        if (matchedDb) {
          const getImgVal = (idx) => {
            if (idx === -1) return "";
            let val = matchedDb[idx];
            if (typeof val === "string" && val.startsWith("[")) {
              try { return JSON.parse(val); } catch (e) { return val; }
            }
            return val;
          };

          dbData.start_mono = getImgVal(col.startMono) || getImgVal(col.start) || "";
          dbData.stop_mono = getImgVal(col.stopMono) || getImgVal(col.stop) || "";
          dbData.start_ais = getImgVal(col.startAis) || "";
          dbData.stop_ais = getImgVal(col.stopAis) || "";

          // Legacy fallbacks for stats
          dbData.startImg = dbData.start_mono;
          dbData.stopImg = dbData.stop_mono;

          if (col.league > -1 && matchedDb[col.league]) dbData.league = matchedDb[col.league];
          if (col.channel > -1 && matchedDb[col.channel]) dbData.channel = matchedDb[col.channel];
        }

        return {
          dashboard: dbData,
          external: { home: homeExt, away: awayExt, score: scoreExt },
          status: matchedDb ? "MATCHED" : "MISSING",
        };
      });

      // จัดเรียงตามวันและเวลา
      reportList.sort((a, b) =>
        (a.dashboard.date + " " + a.dashboard.time).localeCompare(
          b.dashboard.date + " " + b.dashboard.time,
        ),
      );

      const finalResult = API_UTILS.createRes(true, {
        summary: leagueCounts,
        list: reportList,
        stats: {
          totalMatches: reportList.length,
          dateRange: { from: prevDateStr, to: targetDateStr },
        },
      });

      // 💾 4. บันทึกลง Cache (เก็บไว้ 10 นาที)
      try {
        cache.put(cacheKey, JSON.stringify(finalResult), 600);
      } catch (e) {
        console.warn("Cache write error", e);
      }

      return finalResult;
    } catch (e) {
      return API_UTILS.createRes(false, "Error: " + e.toString());
    }
  },

  // ฟังก์ชันเก่าที่ยุบรวมแล้ว (ทิ้งไว้กัน Error ถ้ามีหน้าอื่นเรียก แต่ข้างในเรียกใช้ตัวใหม่แทน)
  getMatchesByDate: function (d) {
    const res = this.getVerificationReport(d);
    if (res.success) {
      return JSON.stringify({
        success: true,
        data: res.data.summary,
        total: res.data.stats.totalMatches,
      });
    }
    return JSON.stringify(res);
  },
};
