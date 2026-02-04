function doGet(e) {
  try {
    return HtmlService.createTemplateFromFile('frontend/index')
      .evaluate()
      .setTitle('GAS SPA App')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) {
    return HtmlService.createHtmlOutput('<h2>Error loading app</h2><p>' + error.message + '</p>');
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 🚀 Generic Helper: Get Data with Cache & Chunking
 * @param {string} sheetName - Name of the sheet to fetch.
 * @param {boolean} forceRefresh - If true, bypass cache and fetch fresh data.
 * @param {number} cacheTime - Cache duration in seconds (default 1200 = 20 min).
 * @return {Array<Array<any>>} The 2D array of values from the sheet.
 */
function getDataWithCache(sheetName, forceRefresh = false, cacheTime = 1200) {
  const cache = CacheService.getScriptCache();
  const CACHE_KEY = `SHEET_DATA_${sheetName}`;

  // 1. Try Cache
  if (!forceRefresh) {
    const cachedData = _getChunkedCache(cache, CACHE_KEY);
    if (cachedData) {
      console.log(`⚡ Cache Hit: ${sheetName}`);
      return JSON.parse(cachedData);
    }
  }

  // 2. Fetch from Sheet
  console.log(`💤 Cache Miss (or Force): Reading ${sheetName}`);
  const sheet = _getSheet(sheetName);
  if (!sheet) {
    console.error(`Sheet '${sheetName}' not found`);
    return [];
  }

  const values = sheet.getDataRange().getValues();

  // 3. Save to Cache (Chunked)
  try {
    _putChunkedCache(cache, CACHE_KEY, JSON.stringify(values), cacheTime);
  } catch (e) {
    console.warn("Failed to cache data (likely too large even for chunks): " + e.message);
  }

  return values;
}

// --- Chunking Helpers ---

function _putChunkedCache(cache, key, dataString, expirationInSeconds) {
  const chunkSize = 100 * 1024; // 100KB safe limit per chunk
  const chunks = [];
  let index = 0;

  while (index < dataString.length) {
    chunks.push(dataString.substr(index, chunkSize));
    index += chunkSize;
  }

  const cacheObj = {};
  cacheObj[key] = String(chunks.length); // Master key stores chunk count

  chunks.forEach((chunk, i) => {
    cacheObj[`${key}_${i}`] = chunk;
  });

  cache.putAll(cacheObj, expirationInSeconds);
}

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
    if (!chunk) return null; // Incomplete cache
    fullString += chunk;
  }

  return fullString;
}
