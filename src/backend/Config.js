/**
 * src/backend/Config.js
 * Centralized Configuration
 */

const CALENDARS_CONFIG_DATA = []; 

// ฟังก์ชันสำหรับ "ตั้งค่าครั้งแรก" (กด Run ฟังก์ชันนี้เพื่อรีเซ็ต Script Properties)
function setupEnvironmentVariables() {
  const props = PropertiesService.getScriptProperties();

  const calendarConfig = [
  { name: "Thai League 1", id: "c_918487f65f5c5739c721876b87f751939331e1d76a9b2a87a44f7d5ab0fdc5fb@group.calendar.google.com" },
  { name: "Thai League 2", id: "c_b8f22a45353df455a9c120389cda7a7f957c40e147046f00f25d5c84cb914e56@group.calendar.google.com" },
  { name: "Thai League 3", id: "c_79c532d941b9411dd23a7ff295342a405f1cc775f12eacdca279d0baec8f9981@group.calendar.google.com" },
  { name: "FA Community Shield", id: "c_22bc862fa7327133868c7cb902adab585c9c54cd196db75c3321a4cf2f900ba7@group.calendar.google.com" },
  { name: "Chang FA Cup", id: "c_dec725334113e13203aabffcba5c96d7d70e53e0b4d06f066ff5c2c4b57663c1@group.calendar.google.com" },
  { name: "Thai Women League 2 ", id: "c_7b6c6bdd19adb98bc1ecc7a92766cad25c9c530ad2a506871fb38e6c121acc40@group.calendar.google.com" },
  { name: "Carabao Cup", id: "c_1a4f4806f3c1bb7b811fffee57c62fee3bb2f1157f2c7938f79fd1fe188f189a@group.calendar.google.com" },
  { name: "EFL", id: "c_8f616edef1fa1e59c4eac7d550d3820b378b7ed97238daceab282fa4a4397e3b@group.calendar.google.com" },
  { name: "Premier League", id: "c_81d9d3fb928e9618f923f5f13f103bbef65ea0bf030eb63525fca483d8a7cf41@group.calendar.google.com" },
  { name: "French League", id: "c_06aa510a9a24d9c1f1acb889c204506a089f466c6f4be6d5bc8f26655a1dc587@group.calendar.google.com" },
  { name: "SV League M_Volleyball", id: "c_78fb7dc5522d1b6f9b5d3c9f49f3c445bc75fb6b67ec4ca0d961850c0ad7ea6c@group.calendar.google.com" },
  { name: "SV League WM_Volleyball", id: "c_68067cce9d7061923cf365a97bcb0a9a0f536b17cabc7d6766adaa65221fe225@group.calendar.google.com" },
  { name: "The Emirates FA Cup", id: "c_34607b8d27abaf635e20cab8295ca2289ae7af5f5db03d122f19424f4cce35a7@group.calendar.google.com" },
  { name: "U21", id: "c_d0658b7942360ae53180a9374e476477be6380dde0c4ade64f79e978b6cef0fd@group.calendar.google.com" },
  { name: "UEFA European", id: "c_c26e7b669b3bfe2b3ce13346f32733caf2f33719aab48f03219c5e3306297e47@group.calendar.google.com" },
  { name: "MUANGTHAI CUP", id: "c_404a3c5692d6d5463183dcbadad8dd3c1e1c3efa0997d9360570fe10bc2cd159@group.calendar.google.com" }
];

  props.setProperties({
    'CORE_SHEET_ID': '1vSI-pdr-WDQ37bNOD61SQMzqAAJ-a_5o00Av391ZyvM', 
    'TICKET_SHEET_ID': '1Y_o6q78ML6S2Orvkgrgw5QxNaTKN3e6Uj0-tDyiP9LQ', 
    'FOLDER_IMG_ID': '1rURdmn4oAc1M5-yA1MXvartb0sx7MIVr', 
    'FOLDER_PDF_ID': '17lzzs1PPDpf7FDNjZJokQGDd9ViIsmhg', 
    'TEMPLATE_DOC_ID': '1vRkb_yvfn2CcwuJ1qrvTwG0Cia1iAGFAFdLHmeKk710', 
    'CHAT_WEBHOOK_MAIN': 'https://chat.googleapis.com/v1/spaces/AAQAi6D-iNc/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=ocKCRN5_AEqKrUn28cFV8ej4AAekGvftXUQzrFRKpv0',
    'CHAT_WEBHOOK_DEV': 'https://chat.googleapis.com/v1/spaces/AAQAXuRmBR0/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=QWHrY6S6zy53YFphoHdTphwlwrUp6NLa0IgWy1JQlKo',
    'CONFIG_CALENDAR': JSON.stringify(calendarConfig),
    'STATS_DB_ID': '1KKldYRYnx5paRkvNRQ6RxYhgH4yBHb91oXuc4cLizyo',
    'STATS_TAB_NAME': 'Match End'
  });

  console.log("✅ Setup Properties เรียบร้อยแล้ว!");
}

// --- CONFIG Object ---
const CONFIG = (() => {
  const props = PropertiesService.getScriptProperties();
  const getVal = (key, legacyKey) => props.getProperty(key) || props.getProperty(legacyKey);
  
  // โหลดค่าพื้นฐานเตรียมไว้ แต่ยังไม่ throw error ถ้าไม่มี
  const coreId = getVal('CORE_SHEET_ID', 'DB_SHEET_ID');
  const ticketId = getVal('TICKET_SHEET_ID') || coreId;

  return {
    DB_ID: coreId,
    TICKET_ID: ticketId,
    SETTING_ID: coreId,
    MATCH_TAB: 'DB_Matches',
    REPORT_TAB: 'DB_Reports',
    TICKET_TAB: 'Ticket',
    IMG_FOLDER: getVal('FOLDER_IMG_ID', 'IMG_FOLDER_ID'),
    PDF_FOLDER: getVal('FOLDER_PDF_ID', 'PDF_FOLDER_ID'),
    TEMPLATE_ID: getVal('TEMPLATE_DOC_ID'),
    STATS_DB_ID: getVal('STATS_DB_ID'),
    STATS_TAB_NAME: getVal('STATS_TAB_NAME'),
    TIMEZONE: 'Asia/Bangkok',
    GET_CALENDARS: () => {
      try { return JSON.parse(getVal('CONFIG_CALENDAR', 'CALENDAR_CONFIG_JSON')) || []; } catch (e) { return []; }
    },
    WEBHOOKS: {
      "group_all": getVal('CHAT_WEBHOOK_MAIN', 'WEBHOOK_GROUP_ALL'),
      "group_dev": getVal('CHAT_WEBHOOK_DEV', 'WEBHOOK_GROUP_DEV')
    }
  };
})();

function setupDatabase() {
  if (!CONFIG.DB_ID) { console.error("❌ CORE_SHEET_ID is missing."); return; }
  const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
  _createSheetIfNotExists(ss, CONFIG.REPORT_TAB, ["Timestamp", "Report Date", "Shift", "Reporter", "Ticket Total", "Match Summary", "Image URLs"]);
  _createSheetIfNotExists(ss, CONFIG.MATCH_TAB, ["Match ID", "Date", "Time", "League", "Home", "Away", "Channel", "Signal", "Status", "Start Image", "Stop Image"]);
  console.log("🎉 Database Structure Verified on:", ss.getName());
}

function _createSheetIfNotExists(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) sheet.appendRow(headers);
    console.log(`Created new sheet: ${sheetName}`);
  }
}

function debugCurrentConfig() {
  console.log("=== CURRENT CONFIGURATION ===");
  console.log("CORE DB ID  :", CONFIG.DB_ID);
  console.log("STATS ID    :", CONFIG.STATS_DB_ID);
  console.log("=============================");
}