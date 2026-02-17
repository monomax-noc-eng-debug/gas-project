/**
 * src/backend/Config.js
 * Centralized Configuration
 */

const CALENDARS_CONFIG_DATA = [];

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
