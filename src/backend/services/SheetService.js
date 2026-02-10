/**
 * SheetService
 * Handles all interactions with Google Sheets (CRUD)
 * Implements Caching and Locking mechanisms.
 */

const SheetService = (() => {

  // --- Private Helpers ---

  function _getDbId() {
    if (typeof CONFIG !== 'undefined' && CONFIG.DB_ID) return CONFIG.DB_ID;
    return PropertiesService.getScriptProperties().getProperty('DB_SHEET_ID');
  }

  function _getSpreadsheet(spreadsheetId = null) {
    const id = spreadsheetId || _getDbId();
    if (!id) throw new Error("Database ID not configured.");
    console.log(`[SheetService] Opening Spreadsheet: ${id}`);
    return SpreadsheetApp.openById(id);
  }

  function _getSheet(sheetName, spreadsheetId = null) {
    const ss = _getSpreadsheet(spreadsheetId);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      const availableSheets = ss.getSheets().map(s => s.getName()).join(', ');
      throw new Error(`Sheet '${sheetName}' not found in spreadsheet. Available sheets: [${availableSheets}]`);
    }
    console.log(`[SheetService] Opened Sheet: ${sheetName}`);
    return sheet;
  }

  // --- Caching Logic (Moved from Main.js) ---

  function _getChunkedCache(cache, key) {
    const countStr = cache.get(key);
    if (!countStr) return null;

    const count = parseInt(countStr, 10);
    const keys = [];
    for (let i = 0; i < count; i++) {
      keys.push(`${key}_${i}`);
    }

    const chunksObj = cache.getAll(keys);
    let fullString = "";

    for (let i = 0; i < count; i++) {
      const chunk = chunksObj[`${key}_${i}`];
      if (!chunk) return null;
      fullString += chunk;
    }
    return fullString;
  }

  function _putChunkedCache(cache, key, dataString, expirationInSeconds) {
    const chunkSize = 100 * 1024;
    const chunks = [];
    let index = 0;

    while (index < dataString.length) {
      chunks.push(dataString.substr(index, chunkSize));
      index += chunkSize;
    }

    const cacheObj = {};
    cacheObj[key] = String(chunks.length);

    chunks.forEach((chunk, i) => {
      cacheObj[`${key}_${i}`] = chunk;
    });

    try {
      cache.putAll(cacheObj, expirationInSeconds);
    } catch (e) {
      console.warn("Cache put failed:", e.message);
    }
  }

  // --- Public Methods ---

  return {
    /**
     * Get all data from a sheet with caching
     * @param {string} sheetName 
     * @param {number} cacheTime (Seconds, default 1200)
     * @param {string} spreadsheetId (Optional) Specific spreadsheet ID to use
     * @return {Array<Array<any>>}
     */
    getAll: function (sheetName, cacheTime = 1200, spreadsheetId = null) {
      const ssId = spreadsheetId || _getDbId();
      const cache = CacheService.getScriptCache();
      const CACHE_KEY = `SHEET_DATA_${ssId}_${sheetName}`;

      // Try Cache
      const cached = _getChunkedCache(cache, CACHE_KEY);
      if (cached) {
        console.log(`⚡ Cache Hit: ${sheetName} (SS: ${ssId})`);
        return JSON.parse(cached);
      }

      console.log(`💤 Cache Miss: Reading ${sheetName} (SS: ${ssId})`);
      const sheet = _getSheet(sheetName, spreadsheetId);
      const data = sheet.getDataRange().getValues();

      // Write Cache
      _putChunkedCache(cache, CACHE_KEY, JSON.stringify(data), cacheTime);
      return data;
    },

    /**
     * Add a row to the sheet (Thread-safe)
     * @param {string} sheetName 
     * @param {Array<any>} rowData 
     * @param {string} spreadsheetId (Optional) Specific spreadsheet ID to use
     * @return {boolean} success
     */
    add: function (sheetName, rowData, spreadsheetId = null) {
      const ssId = spreadsheetId || _getDbId();
      const lock = LockService.getScriptLock();
      console.log(`[SheetService.add] Adding to ${sheetName} in SS: ${ssId}`);
      console.log(`[SheetService.add] Row data length: ${rowData.length}`);
      try {
        if (lock.tryLock(10000)) { // Wait up to 10s
          const sheet = _getSheet(sheetName, spreadsheetId);
          sheet.appendRow(rowData);
          console.log(`[SheetService.add] ✅ Row appended successfully`);

          // Invalidate Cache
          CacheService.getScriptCache().remove(`SHEET_DATA_${ssId}_${sheetName}`);
          return true;
        } else {
          console.error(`[SheetService.add] ❌ Lock timeout`);
          throw new Error("Could not obtain lock for adding data.");
        }
      } catch (e) {
        console.error(`[SheetService.add] ❌ Error: ${e.toString()}`);
        throw e; // Re-throw so caller can handle
      } finally {
        lock.releaseLock();
      }
    },

    /**
     * Update a row by ID (Thread-safe)
     * Assumes Header Row is 1, ID is in a specific column (default Column A / Index 0)
     * @param {string} sheetName 
     * @param {string|number} id - The value to match
     * @param {Object} dataMap - Key-Value pair of { "HeaderName": "Value" }
     * @param {string} idColumnName - (Optional) Header name of the ID column, defaults to first column if null.
     * @param {string} spreadsheetId (Optional) Specific spreadsheet ID to use
     */
    update: function (sheetName, id, dataMap, idColumnName = null, spreadsheetId = null) {
      const ssId = spreadsheetId || _getDbId();
      const lock = LockService.getScriptLock();
      console.log(`[SheetService.update] Updating ${id} in ${sheetName} (SS: ${ssId})`);
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getSheet(sheetName, spreadsheetId);
          const data = sheet.getDataRange().getValues();
          if (data.length < 2) throw new Error("Sheet is empty or only has headers");

          const headers = data[0];
          let idColIndex = 0;

          if (idColumnName) {
            idColIndex = headers.indexOf(idColumnName);
            if (idColIndex === -1) throw new Error(`Header '${idColumnName}' not found`);
          }

          // Find Row (1-based index for API, but data is 0-based)
          // data[i] corresponds to row i+1
          let rowIndex = -1;
          for (let i = 1; i < data.length; i++) {
            if (String(data[i][idColIndex]) === String(id)) {
              rowIndex = i + 1; // logical row index
              break;
            }
          }

          if (rowIndex === -1) throw new Error(`ID '${id}' not found`);

          // Prepare Updates
          Object.keys(dataMap).forEach(key => {
            const colIndex = headers.indexOf(key);
            if (colIndex !== -1) {
              // getRange(row, col).setValue(val)
              // row is rowIndex, col is colIndex + 1
              sheet.getRange(rowIndex, colIndex + 1).setValue(dataMap[key]);
            }
          });

          // Invalidate Cache
          CacheService.getScriptCache().remove(`SHEET_DATA_${ssId}_${sheetName}`);
          console.log(`[SheetService.update] ✅ Updated successfully`);
          return true;

        } else {
          console.error(`[SheetService.update] ❌ Lock timeout`);
          throw new Error("Could not obtain lock for updating data.");
        }
      } catch (e) {
        console.error(`[SheetService.update] ❌ Error: ${e.toString()}`);
        throw e;
      } finally {
        lock.releaseLock();
      }
    },

    /**
     * Delete a row by ID (Thread-safe)
     * @param {string} sheetName 
     * @param {string|number} id 
     * @param {string} idColumnName (Optional)
     * @param {string} spreadsheetId (Optional) Specific spreadsheet ID to use
     */
    delete: function (sheetName, id, idColumnName = null, spreadsheetId = null) {
      const ssId = spreadsheetId || _getDbId();
      const lock = LockService.getScriptLock();
      console.log(`[SheetService.delete] Deleting ${id} from ${sheetName} (SS: ${ssId})`);
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getSheet(sheetName, spreadsheetId);
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          let idColIndex = 0;

          if (idColumnName) {
            idColIndex = headers.indexOf(idColumnName);
            if (idColIndex === -1) throw new Error(`Header '${idColumnName}' not found`);
          }

          // Find Row
          for (let i = 1; i < data.length; i++) {
            if (String(data[i][idColIndex]) === String(id)) {
              sheet.deleteRow(i + 1);

              // Invalidate Cache
              CacheService.getScriptCache().remove(`SHEET_DATA_${ssId}_${sheetName}`);
              console.log(`[SheetService.delete] ✅ Deleted successfully`);
              return true;
            }
          }
          throw new Error(`ID '${id}' not found`);
        } else {
          console.error(`[SheetService.delete] ❌ Lock timeout`);
          throw new Error("Could not obtain lock for deleting data.");
        }
      } catch (e) {
        console.error(`[SheetService.delete] ❌ Error: ${e.toString()}`);
        throw e;
      } finally {
        lock.releaseLock();
      }
    }
  };
})();
