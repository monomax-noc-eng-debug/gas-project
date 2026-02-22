/**
 * SheetService
 * Handles all interactions with Google Sheets (CRUD)
 * Implements Caching, Locking mechanisms, and High-Performance Batch Operations.
 */

const SheetService = (() => {
  // --- Private Helpers ---

  function _getDbId() {
    if (typeof CONFIG !== "undefined" && CONFIG.DB_ID) return CONFIG.DB_ID;
    return PropertiesService.getScriptProperties().getProperty("DB_SHEET_ID");
  }

  function _getSpreadsheet(spreadsheetId = null) {
    const id = spreadsheetId || _getDbId();
    if (!id) throw new Error("Database ID not configured.");
    return SpreadsheetApp.openById(id);
  }

  function _getSheet(sheetName, spreadsheetId = null) {
    const ss = _getSpreadsheet(spreadsheetId);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      const availableSheets = ss
        .getSheets()
        .map((s) => s.getName())
        .join(", ");
      throw new Error(
        `Sheet '${sheetName}' not found in spreadsheet. Available sheets: [${availableSheets}]`,
      );
    }
    return sheet;
  }

  // --- Caching Logic ---

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
     */
    getAll: function (
      sheetName,
      cacheTime = 1200,
      spreadsheetId = null,
      skipCache = false,
    ) {
      const ssId = spreadsheetId || _getDbId();
      const cache = CacheService.getScriptCache();
      const CACHE_KEY = `SHEET_DATA_${ssId}_${sheetName}`;

      if (!skipCache) {
        const cached = _getChunkedCache(cache, CACHE_KEY);
        if (cached) return JSON.parse(cached);
      }

      const sheet = _getSheet(sheetName, spreadsheetId);
      const data = sheet.getDataRange().getValues();

      _putChunkedCache(cache, CACHE_KEY, JSON.stringify(data), cacheTime);
      return data;
    },

    /**
     * Ensure a sheet exists, create if not
     */
    ensureSheet: function (sheetName, headers, spreadsheetId = null) {
      const ssId = spreadsheetId || _getDbId();
      const ss = SpreadsheetApp.openById(ssId);
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        if (headers && headers.length > 0) {
          sheet.appendRow(headers);
        }
      }
      return sheet;
    },

    /**
     * Add a single row to the sheet
     */
    add: function (sheetName, rowData, spreadsheetId = null) {
      const ssId = spreadsheetId || _getDbId();
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getSheet(sheetName, spreadsheetId);
          sheet.appendRow(rowData);
          CacheService.getScriptCache().remove(
            `SHEET_DATA_${ssId}_${sheetName}`,
          );
          return true;
        } else {
          throw new Error("Could not obtain lock for adding data.");
        }
      } catch (e) {
        throw e;
      } finally {
        lock.releaseLock();
      }
    },

    /**
     * ✨ NEW: Add multiple rows at once (Batch Insert for High Performance)
     */
    addBatch: function (sheetName, multipleRowData, spreadsheetId = null) {
      if (!multipleRowData || multipleRowData.length === 0) return true;
      const ssId = spreadsheetId || _getDbId();
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(15000)) {
          const sheet = _getSheet(sheetName, spreadsheetId);
          const startRow = sheet.getLastRow() + 1;
          const numRows = multipleRowData.length;
          const numCols = multipleRowData[0].length;

          sheet
            .getRange(startRow, 1, numRows, numCols)
            .setValues(multipleRowData);
          CacheService.getScriptCache().remove(
            `SHEET_DATA_${ssId}_${sheetName}`,
          );
          return true;
        } else {
          throw new Error("Could not obtain lock for batch adding data.");
        }
      } catch (e) {
        throw e;
      } finally {
        lock.releaseLock();
      }
    },

    /**
     * ⚡ OPTIMIZED: Update a row by ID (Uses memory array and 1 API call)
     */
    update: function (
      sheetName,
      id,
      dataMap,
      idColumnName = null,
      spreadsheetId = null,
    ) {
      const ssId = spreadsheetId || _getDbId();
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getSheet(sheetName, spreadsheetId);
          const lastRow = sheet.getLastRow();
          const lastCol = sheet.getLastColumn();

          if (lastRow < 2)
            throw new Error("Sheet is empty or only has headers");

          // 1. ดึงแค่แถว Header มาเพื่อหาตำแหน่งคอลัมน์
          const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
          let idColIndex = 0;

          if (idColumnName) {
            idColIndex = headers.indexOf(idColumnName);
            if (idColIndex === -1)
              throw new Error(`Header '${idColumnName}' not found`);
          }

          // 2. ดึงเฉพาะคอลัมน์ ID มาหาบรรทัด (ประหยัด Memory และเร็วมาก)
          const idData = sheet
            .getRange(1, idColIndex + 1, lastRow, 1)
            .getValues();
          let rowIndex = -1;
          for (let i = 1; i < idData.length; i++) {
            if (String(idData[i][0]) === String(id)) {
              rowIndex = i + 1;
              break;
            }
          }

          if (rowIndex === -1) throw new Error(`ID '${id}' not found`);

          // 3. ดึงข้อมูลของแถวนั้นมาปรับแก้ใน Memory
          const rowRange = sheet.getRange(rowIndex, 1, 1, lastCol);
          const rowValues = rowRange.getValues()[0];

          Object.keys(dataMap).forEach((key) => {
            const colIndex = headers.indexOf(key);
            if (colIndex !== -1) {
              rowValues[colIndex] = dataMap[key];
            }
          });

          // 4. บันทึกทับรวดเดียว (1 API Call แทนที่จะเป็น N Calls)
          rowRange.setValues([rowValues]);

          CacheService.getScriptCache().remove(
            `SHEET_DATA_${ssId}_${sheetName}`,
          );
          return true;
        } else {
          throw new Error("Could not obtain lock for updating data.");
        }
      } catch (e) {
        throw e;
      } finally {
        lock.releaseLock();
      }
    },

    /**
     * ⚡ OPTIMIZED: Delete a row by ID
     */
    delete: function (
      sheetName,
      id,
      idColumnName = null,
      spreadsheetId = null,
    ) {
      const ssId = spreadsheetId || _getDbId();
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(10000)) {
          const sheet = _getSheet(sheetName, spreadsheetId);
          const lastRow = sheet.getLastRow();
          if (lastRow < 2) throw new Error("Sheet is empty");

          const headers = sheet
            .getRange(1, 1, 1, sheet.getLastColumn())
            .getValues()[0];
          let idColIndex = 0;

          if (idColumnName) {
            idColIndex = headers.indexOf(idColumnName);
            if (idColIndex === -1)
              throw new Error(`Header '${idColumnName}' not found`);
          }

          // ดึงเฉพาะคอลัมน์ ID มาหาบรรทัดที่จะลบ
          const idData = sheet
            .getRange(1, idColIndex + 1, lastRow, 1)
            .getValues();
          for (let i = 1; i < idData.length; i++) {
            if (String(idData[i][0]) === String(id)) {
              sheet.deleteRow(i + 1);
              CacheService.getScriptCache().remove(
                `SHEET_DATA_${ssId}_${sheetName}`,
              );
              return true;
            }
          }
          throw new Error(`ID '${id}' not found`);
        } else {
          throw new Error("Could not obtain lock for deleting data.");
        }
      } catch (e) {
        throw e;
      } finally {
        lock.releaseLock();
      }
    },

    /**
     * Overwrite entire sheet context (Clear & Replace)
     */
    overwriteAll: function (sheetName, data, headers, spreadsheetId = null) {
      const ssId = spreadsheetId || _getDbId();
      const lock = LockService.getScriptLock();

      if (lock.tryLock(15000)) {
        try {
          const sheet = this.ensureSheet(sheetName, headers, ssId);
          sheet.clear();

          if (headers && headers.length > 0) {
            sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          }

          if (data && data.length > 0) {
            const numRows = data.length;
            const numCols = data[0].length;
            if (numRows > 0 && numCols > 0) {
              sheet.getRange(2, 1, numRows, numCols).setValues(data);
            }
          }

          CacheService.getScriptCache().remove(
            `SHEET_DATA_${ssId}_${sheetName}`,
          );
          return true;
        } catch (e) {
          throw e;
        } finally {
          lock.releaseLock();
        }
      } else {
        throw new Error("System Busy (Lock timeout)");
      }
    },
  };
})();
