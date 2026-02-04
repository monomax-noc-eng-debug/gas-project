/**
 * src/backend/Config.js
 * รวมค่า Configuration และ ID ต่างๆ (Corrected IDs)
 */

const CALENDARS_CONFIG_DATA = []; // Load from ScriptProperties 'CALENDAR_CONFIG_JSON'

/**
 * 🔐 Setup Script Properties (One-time Setup)
 * Run this function ONCE manually after filling in your secrets, then clear the values from this file.
 */
function setupScriptProperties() {
  const props = PropertiesService.getScriptProperties();

  // ⚠️ REPLACE THESE WITH YOUR ACTUAL IDs BEFORE RUNNING ⚠️
  // Once run, you can clear these values to secure your code.
  const SECRETS = {
    'DB_SHEET_ID': 'YOUR_MAIN_SHEET_ID',
    'TICKET_SHEET_ID': 'YOUR_TICKET_SHEET_ID',
    'TICKET_TAB_NAME': 'Ticket',
    'MATCH_SHEET_ID': 'YOUR_MAIN_SHEET_ID', // Usually same as DB_SHEET_ID
    'MATCH_TAB_NAME': 'DB_Matches',
    'TEMPLATE_DOC_ID': 'YOUR_TEMPLATE_DOC_ID',
    'IMG_FOLDER_ID': 'YOUR_IMG_FOLDER_ID',
    'PDF_FOLDER_ID': 'YOUR_PDF_FOLDER_ID',
    'WEBHOOK_GROUP_ALL': 'YOUR_WEBHOOK_URL_ALL',
    'WEBHOOK_GROUP_DEV': 'YOUR_WEBHOOK_URL_DEV',
    'CALENDAR_CONFIG_JSON': JSON.stringify([
      // Add your calendar objects here: { name: "...", id: "..." }
      // Example: { name: "Thai League 1", id: "..." }
    ])
  };

  props.setProperties(SECRETS);
  console.log("✅ Script Properties Updated. You may now clear the secrets from Config.js.");
}

function setupDatabase() {
  const dbId = PropertiesService.getScriptProperties().getProperty('DB_SHEET_ID');
  if (!dbId || dbId === 'YOUR_MAIN_SHEET_ID') {
    console.error("❌ DB_SHEET_ID is missing or not set. Please configure Script Properties.");
    return;
  }
  const ss = SpreadsheetApp.openById(dbId);
  _createSheetIfNotExists(ss, "DB_Reports", ["Timestamp", "Report Date", "Shift", "Reporter", "Ticket Total", "Match Summary", "Image URLs", "PDF Report Link"]);
  _createSheetIfNotExists(ss, "DB_Matches", ["Match ID", "Date", "Time", "League", "Home", "Away", "Channel", "Signal", "Status", "Image In", "Image Out"]);
  console.log("🎉 Database Structure Verified!");
}

const CONFIG = (() => {
  const props = PropertiesService.getScriptProperties();
  const calJson = props.getProperty('CALENDAR_CONFIG_JSON');

  return {
    DB_ID: props.getProperty('DB_SHEET_ID'),

    TICKET_ID: props.getProperty('TICKET_SHEET_ID'),
    TICKET_TAB: props.getProperty('TICKET_TAB_NAME'),

    MATCH_ID: props.getProperty('MATCH_SHEET_ID'),
    MATCH_TAB: props.getProperty('MATCH_TAB_NAME'),

    TEMPLATE_ID: props.getProperty('TEMPLATE_DOC_ID'),
    IMG_FOLDER: props.getProperty('IMG_FOLDER_ID'),
    PDF_FOLDER: props.getProperty('PDF_FOLDER_ID'),
    TIMEZONE: 'Asia/Bangkok',

    GET_CALENDARS: () => {
      try { return calJson ? JSON.parse(calJson) : []; }
      catch (e) { return []; }
    },

    WEBHOOKS: {
      "group_all": props.getProperty('WEBHOOK_GROUP_ALL'),
      "group_dev": props.getProperty('WEBHOOK_GROUP_DEV')
    }
  };
})();

function _getSheet(tabName) {
  if (!CONFIG.DB_ID) throw new Error("CONFIG.DB_ID is missing");
  var ss = SpreadsheetApp.openById(CONFIG.DB_ID);
  return tabName ? ss.getSheetByName(tabName) : ss;
}

function _createSheetIfNotExists(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) sheet.appendRow(headers);
  }
}