function runDailyAutoJob() {
  console.log("⏰ Sync Calendar Started...");
  const calendars = CONFIG.GET_CALENDARS();
  if (!calendars.length) return console.error("No calendars config");

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  let allEvents = [];
  calendars.forEach(calConf => {
    try {
      const cal = CalendarApp.getCalendarById(calConf.id);
      if (cal) {
        cal.getEvents(startDate, endDate).forEach(evt => {
          allEvents.push({
            league: calConf.name,
            title: evt.getTitle(),
            start: evt.getStartTime(),
            desc: evt.getDescription() || ""
          });
        });
      }
    } catch (e) { console.warn(`Error fetching ${calConf.name}`); }
  });

  saveMatchesToDB(allEvents);
}

function saveMatchesToDB(events) {
  const sheet = _getSheet("DB_Matches");
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const newRows = events.map(evt => {
    let row = new Array(headers.length).fill("");
    const set = (h, v) => { const i = headers.indexOf(h); if (i > -1) row[i] = v; };

    const dateStr = Utilities.formatDate(evt.start, CONFIG.TIMEZONE, "yyyy-MM-dd");
    const timeStr = Utilities.formatDate(evt.start, CONFIG.TIMEZONE, "HH:mm");
    let channel = "-";
    const m = evt.desc.match(/Channel\s*:\s*([^\n]+)/i);
    if (m) channel = m[1].trim();
    const teams = evt.title.split(/\s*v.?s.?\s*/i);

    set("Match ID", `M-${evt.start.getTime()}`);
    set("Date", dateStr);
    set("Time", timeStr);
    set("League", evt.league);
    set("Home", teams[0] || evt.title);
    set("Away", teams[1] || "-");
    set("Channel", channel);
    set("Signal", "NON"); // ✅ Default NON
    set("Status", "WAIT");
    return row;
  });

  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  if (newRows.length > 0) {
    newRows.sort((a, b) => (a[headers.indexOf("Date")] + a[headers.indexOf("Time")]).localeCompare(b[headers.indexOf("Date")] + b[headers.indexOf("Time")]));
    sheet.getRange(2, 1, newRows.length, headers.length).setValues(newRows);
  }
  console.log(`✅ Saved ${newRows.length} matches.`);
}