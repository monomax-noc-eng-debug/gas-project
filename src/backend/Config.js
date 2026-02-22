/**
 * src/backend/Config.js
 * Centralized Configuration (Lazy Loading Optimization)
 */

const CALENDARS_CONFIG_DATA = [];

// --- CONFIG Object ---
const CONFIG = (() => {
  let props = null;
  // เรียกใช้ PropertiesService เมื่อจำเป็นเท่านั้น
  const getVal = (key, legacyKey) => {
    if (!props) props = PropertiesService.getScriptProperties();
    return props.getProperty(key) || props.getProperty(legacyKey);
  };

  return {
    // ใช้ Getter (get) เพื่อให้โค้ดทำงานก็ต่อเมื่อมีการเรียกใช้ CONFIG.DB_ID
    get DB_ID() {
      return getVal("CORE_SHEET_ID", "DB_SHEET_ID");
    },
    get TICKET_ID() {
      return getVal("TICKET_SHEET_ID") || this.DB_ID;
    },
    get SETTING_ID() {
      return this.DB_ID;
    },
    MATCH_TAB: "DB_Matches",
    REPORT_TAB: "DB_Reports",
    TICKET_TAB: "Ticket",
    get IMG_FOLDER() {
      return getVal("FOLDER_IMG_ID", "IMG_FOLDER_ID");
    },
    get PDF_FOLDER() {
      return getVal("FOLDER_PDF_ID", "PDF_FOLDER_ID");
    },
    get TEMPLATE_ID() {
      return getVal("TEMPLATE_DOC_ID");
    },
    get STATS_DB_ID() {
      return getVal("STATS_DB_ID");
    },
    get STATS_TAB_NAME() {
      return getVal("STATS_TAB_NAME");
    },
    TIMEZONE: "Asia/Bangkok",
    GET_CALENDARS: () => {
      try {
        return (
          JSON.parse(getVal("CONFIG_CALENDAR", "CALENDAR_CONFIG_JSON")) || []
        );
      } catch (e) {
        return [];
      }
    },
    get WEBHOOKS() {
      return {
        group_all: getVal("CHAT_WEBHOOK_MAIN", "WEBHOOK_GROUP_ALL"),
        group_dev: getVal("CHAT_WEBHOOK_DEV", "WEBHOOK_GROUP_DEV"),
      };
    },
  };
})();
