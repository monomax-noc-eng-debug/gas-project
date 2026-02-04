function syncCalendarToSheet() {
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
            id: evt.getId(), // ✅ Stable ID
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

  // 1. Read All Data (Batch Read)
  const dataRange = sheet.getDataRange();
  const data = dataRange.getValues();
  const headers = data[0];

  // Map Column Indices
  // Assuming "Match ID" is Column A (Index 0) as requested by user
  // We prefer finding it dynamically to be safe, but fallback to 0.
  let COL_ID = headers.indexOf("Match ID");
  if (COL_ID === -1) COL_ID = 0;

  const COL_DATE = headers.indexOf("Date");
  const COL_TIME = headers.indexOf("Time");
  const COL_LEAGUE = headers.indexOf("League");
  const COL_HOME = headers.indexOf("Home");
  const COL_AWAY = headers.indexOf("Away");
  const COL_CHANNEL = headers.indexOf("Channel");
  const COL_STATUS = headers.indexOf("Status");
  const COL_SIGNAL = headers.indexOf("Signal");

  // 2. Map Existing Data by ID
  const idMap = new Map();
  // Start from row 1 (skip header)
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][COL_ID]); // Use Column A logic
    if (id) idMap.set(id, i); // Store index in 'data' array
  }

  // 3. Process Events (Upsert)
  const newRows = [];
  let updateCount = 0;

  events.forEach(evt => {
    const id = evt.id;
    const dateStr = Utilities.formatDate(evt.start, CONFIG.TIMEZONE, "yyyy-MM-dd");
    const timeStr = Utilities.formatDate(evt.start, CONFIG.TIMEZONE, "HH:mm");

    // Parse Description/Title
    let channel = "-";
    const m = evt.desc.match(/Channel\s*:\s*([^\n]+)/i);
    if (m) channel = m[1].trim();

    const teams = evt.title.split(/\s*v.?s.?\s*/i);
    const home = teams[0] || evt.title;
    const away = teams[1] || "-";

    if (idMap.has(id)) {
      // ✅ UPDATE EXISTING ROW
      const rowIndex = idMap.get(id);
      const row = data[rowIndex];

      // Update fields
      if (COL_DATE > -1) row[COL_DATE] = dateStr;
      if (COL_TIME > -1) row[COL_TIME] = timeStr;
      if (COL_LEAGUE > -1) row[COL_LEAGUE] = evt.league;
      if (COL_HOME > -1) row[COL_HOME] = home;
      if (COL_AWAY > -1) row[COL_AWAY] = away;
      if (COL_CHANNEL > -1) row[COL_CHANNEL] = channel;

      // Preserve "Status" & "Signal" (Do not overwrite with default if value exists)
      if (COL_STATUS > -1 && !row[COL_STATUS]) row[COL_STATUS] = "WAIT";
      if (COL_SIGNAL > -1 && !row[COL_SIGNAL]) row[COL_SIGNAL] = "NON";

      updateCount++;
    } else {
      // ✅ APPEND NEW ROW
      const newRow = new Array(headers.length).fill("");
      newRow[COL_ID] = id;
      if (COL_DATE > -1) newRow[COL_DATE] = dateStr;
      if (COL_TIME > -1) newRow[COL_TIME] = timeStr;
      if (COL_LEAGUE > -1) newRow[COL_LEAGUE] = evt.league;
      if (COL_HOME > -1) newRow[COL_HOME] = home;
      if (COL_AWAY > -1) newRow[COL_AWAY] = away;
      if (COL_CHANNEL > -1) newRow[COL_CHANNEL] = channel;
      if (COL_STATUS > -1) newRow[COL_STATUS] = "WAIT";
      if (COL_SIGNAL > -1) newRow[COL_SIGNAL] = "NON";

      data.push(newRow); // Add to local data array
      newRows.push(newRow); // Track new
    }
  });

  // 4. Batch Write Back
  // We write the ENTIRE data array back. This is safer than writing just updates + appends separately 
  // because rows might have shifted if we deleted anything (though we didn't delete here).
  // Optimization: If only appending, we could use sheet.appendRow, but we have mixed updates.
  // Writing the full range is the most reliable batch method.

  if (data.length > 0) {
    // Sort logic (Optional: Sort by Date/Time)
    // Create a body slice for sorting, keep header separate
    const headerRow = data[0];
    const bodyRows = data.slice(1);

    bodyRows.sort((a, b) => {
      // Sort by Date (String "yyyy-MM-dd")
      const dateA = String(a[COL_DATE]);
      const dateB = String(b[COL_DATE]);
      if (dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }

      // Sort by Time (String "HH:mm")
      const timeA = String(a[COL_TIME]);
      const timeB = String(b[COL_TIME]);
      return timeA.localeCompare(timeB);
    });

    // Reconstruct
    const finalData = [headerRow, ...bodyRows];

    // Write
    // Note: If the new data is SHORTER than previous sheet content (e.g. rows deleted), 
    // we should clear existing content first?
    // User warned: "DO NOT use .clearContent() on the whole range".
    // Strategy: Write over available range. If specific rows need clearing at the bottom, handle them.
    // However, we are only upserting (adding/updating), so total rows should >= initial rows.

    sheet.getRange(1, 1, finalData.length, finalData[0].length).setValues(finalData);
  }

  console.log(`✅ Sync Complete: ${updateCount} updated, ${newRows.length} inserted.`);
}

/**
 * Alias for frontend compatibility (Settings page calls this function name)
 */
function runDailyAutoJob() {
  return syncCalendarToSheet();
}