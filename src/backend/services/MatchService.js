const MatchService = {
  getMatchesByDate: function (d) {
    try {
      const statsId = (typeof CONFIG !== 'undefined') ? CONFIG.STATS_DB_ID : PropertiesService.getScriptProperties().getProperty('STATS_DB_ID');
      const statsTab = (typeof CONFIG !== 'undefined') ? CONFIG.STATS_TAB_NAME : "Match End";
      if (!statsId) return API_UTILS.createRes(false, "STATS_DB_ID missing");
      const ss = SpreadsheetApp.openById(statsId);
      const sheet = ss.getSheetByName(statsTab);
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const findCol = (keys) => headers.findIndex(h => keys.some(k => String(h).toLowerCase().includes(k.toLowerCase())));
      const idx = { date: findCol(["date", "วันที่"]), time: findCol(["time", "kickoff"]), league: findCol(["league", "program"]), home: findCol(["home", "team 1"]), away: findCol(["away", "team 2"]) };

      const targetDateObj = d ? new Date(d) : new Date();
      const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
      const targetDateStr = Utilities.formatDate(targetDateObj, tz, "yyyy-MM-dd");
      const prevDateObj = new Date(targetDateObj); prevDateObj.setDate(targetDateObj.getDate() - 1);
      const prevDateStr = Utilities.formatDate(prevDateObj, tz, "yyyy-MM-dd");

      const filtered = data.slice(1).filter(row => {
        const rDateStr = API_UTILS.formatDateTime(row[idx.date], 'date');
        const rTimeStr = API_UTILS.formatDateTime(row[idx.time], 'time');
        if (rDateStr === prevDateStr && rTimeStr >= "10:00") return true;
        if (rDateStr === targetDateStr && rTimeStr < "10:00") return true;
        return false;
      });

      let leagueCounts = {};
      filtered.forEach(row => {
        let league = row[idx.league] || "Other";
        const lUpper = String(league).toUpperCase().trim();
        let groupLeague = league;
        if (lUpper.includes("SV LEAGUE") && lUpper.includes("VOLLEYBALL")) groupLeague = "SV League Volleyball";
        else if (lUpper.includes("THAI LEAGUE")) groupLeague = "Thai League";
        else if (lUpper.includes("FRENCH")) groupLeague = "French League";
        else if (lUpper.includes("PREMIER LEAGUE")) groupLeague = "Premier League";
        else if (lUpper.includes("EFL")) groupLeague = "EFL";
        leagueCounts[groupLeague] = (leagueCounts[groupLeague] || 0) + 1;
      });
      return JSON.stringify({ success: true, data: leagueCounts, total: filtered.length, text: "" });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  },

  getVerificationReport: function (dateStr) {
    try {
      const statsId = (typeof CONFIG !== 'undefined') ? CONFIG.STATS_DB_ID : PropertiesService.getScriptProperties().getProperty('STATS_DB_ID');
      const statsTab = (typeof CONFIG !== 'undefined') ? CONFIG.STATS_TAB_NAME : "Match End";
      if (!statsId) return API_UTILS.createRes(false, "STATS_DB_ID missing");
      const ssExt = SpreadsheetApp.openById(statsId);
      const sheetExt = ssExt.getSheetByName(statsTab);
      const dataExt = sheetExt.getDataRange().getValues();
      const headersExt = dataExt[0];
      const findColExt = (keys) => headersExt.findIndex(h => keys.some(k => String(h).toLowerCase().includes(k.toLowerCase())));
      const idxExt = { date: findColExt(["date", "วันที่"]), time: findColExt(["time", "kickoff"]), league: findColExt(["league", "program"]), home: findColExt(["home", "team 1"]), away: findColExt(["away", "team 2"]), score: findColExt(["score", "ft", "ผล"]) };

      const targetDateObj = dateStr ? new Date(dateStr) : new Date();
      const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
      const targetDateStr = Utilities.formatDate(targetDateObj, tz, "yyyy-MM-dd");
      const prevDateObj = new Date(targetDateObj); prevDateObj.setDate(targetDateObj.getDate() - 1);
      const prevDateStr = Utilities.formatDate(prevDateObj, tz, "yyyy-MM-dd");

      const filteredExtRaw = dataExt.slice(1).filter(row => {
        const rDateStr = API_UTILS.formatDateTime(row[idxExt.date], 'date');
        const rTimeStr = API_UTILS.formatDateTime(row[idxExt.time], 'time');
        if (rDateStr === prevDateStr && rTimeStr >= "10:00") return true;
        if (rDateStr === targetDateStr && rTimeStr < "10:00") return true;
        return false;
      });

      const uniqueMap = new Map();
      filteredExtRaw.forEach(row => {
        const time = API_UTILS.formatDateTime(row[idxExt.time], 'time');
        const home = String(row[idxExt.home] || "").toLowerCase().replace(/\s/g, "");
        if (!uniqueMap.has(`${time}_${home}`)) uniqueMap.set(`${time}_${home}`, row);
      });
      const filteredExt = Array.from(uniqueMap.values());

      const sheetDb = API_UTILS.getDbSheet();
      const dataDb = sheetDb.getDataRange().getValues();
      const headerMapDb = API_UTILS.getHeaderMap(sheetDb);
      const findColDb = (keys) => keys.find(k => headerMapDb.hasOwnProperty(k.toLowerCase()));
      const colDbDate = findColDb(["date"]);
      const colDbTime = findColDb(["time", "kickoff"]);
      const colDbHome = findColDb(["home", "team 1"]);
      const colDbAway = findColDb(["away", "team 2"]);
      const colDbStart = findColDb(["start image", "start"]);
      const colDbStop = findColDb(["stop image", "stop"]);
      const colDbLeague = findColDb(["league"]);

      const filteredDb = dataDb.slice(1).filter(row => {
        const rDateStr = API_UTILS.formatDateTime(row[headerMapDb[colDbDate]], 'date');
        const rTimeStr = API_UTILS.formatDateTime(row[headerMapDb[colDbTime]], 'time');
        if (rDateStr === prevDateStr && rTimeStr >= "10:00") return true;
        if (rDateStr === targetDateStr && rTimeStr < "10:00") return true;
        return false;
      });

      const norm = (str) => String(str || "").toLowerCase().replace(/\s/g, "");

      let reportList = filteredExt.map(rowExt => {
        const homeExt = String(rowExt[idxExt.home] || "").trim();
        const awayExt = String(rowExt[idxExt.away] || "").trim();
        const timeExt = API_UTILS.formatDateTime(rowExt[idxExt.time], 'time');
        const leagueExt = rowExt[idxExt.league] || "";
        const scoreExt = (idxExt.score > -1) ? rowExt[idxExt.score] : "-";

        const matchedDb = filteredDb.find(rowDb => {
          const hDb = norm(rowDb[headerMapDb[colDbHome]]);
          const aDb = norm(rowDb[headerMapDb[colDbAway]]);
          const hEx = norm(homeExt);
          const aEx = norm(awayExt);
          return (hDb === hEx && aDb === aEx) || (hDb === aEx && aDb === hEx);
        });

        const dateExt = API_UTILS.formatDateTime(rowExt[idxExt.date], 'date');

        let status = "MISSING", dbData = { date: dateExt, time: timeExt, home: homeExt, away: awayExt, league: leagueExt, startImg: "", stopImg: "" };
        if (matchedDb) {
          status = "MATCHED";
          dbData = {
            date: API_UTILS.formatDateTime(matchedDb[headerMapDb[colDbDate]], 'date') || dateExt,
            time: API_UTILS.formatDateTime(matchedDb[headerMapDb[colDbTime]], 'time'),
            home: matchedDb[headerMapDb[colDbHome]],
            away: matchedDb[headerMapDb[colDbAway]],
            league: matchedDb[headerMapDb[colDbLeague]] || leagueExt,
            startImg: colDbStart ? matchedDb[headerMapDb[colDbStart]] : "",
            stopImg: colDbStop ? matchedDb[headerMapDb[colDbStop]] : ""
          };
        }
        return { dashboard: dbData, external: { home: homeExt, away: awayExt, score: scoreExt }, status: status };
      });

      reportList.sort((a, b) => a.dashboard.time.localeCompare(b.dashboard.time));
      return API_UTILS.createRes(true, { list: reportList, stats: { totalMatches: reportList.length, dateRange: { from: prevDateStr, to: targetDateStr } } });
    } catch (e) { return API_UTILS.createRes(false, "Error: " + e.toString()); }
  }
};