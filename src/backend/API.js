// =================================================================
// 🔧 UTILITIES (Shared)
// =================================================================
const API_UTILS = (() => {
  const getDbId = () => (typeof CONFIG !== 'undefined' ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty('CORE_SHEET_ID'));

  return {
    getDbSheet: function () {
      const dbId = getDbId();
      if (!dbId) throw new Error("DB_ID is missing.");
      return SpreadsheetApp.openById(dbId).getSheetByName("DB_Matches");
    },
    createRes: function (s, d) { return JSON.stringify(s ? { success: true, data: d } : { success: false, message: d }); },
    getHeaderMap: function (sheet) {
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      return headers.reduce((acc, colName, idx) => {
        acc[colName.toLowerCase().trim()] = idx;
        return acc;
      }, { _headers: headers });
    },
    parseCustomDateTime: function (val) {
      if (!val) return { date: null, time: null, obj: null };
      const strVal = String(val).trim();
      if (strVal === "" || strVal === "-") return { date: null, time: null, obj: null };
      let dObj = null;
      const dmy = strVal.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
      if (dmy) {
        dObj = new Date(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}T${(dmy[4] || "00").padStart(2, '0')}:${(dmy[5] || "00").padStart(2, '0')}:00`);
      } else {
        const ymd = strVal.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
        if (ymd) {
          dObj = new Date(`${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}T${(ymd[4] || "00").padStart(2, '0')}:${(ymd[5] || "00").padStart(2, '0')}:00`);
        } else {
          dObj = new Date(val);
        }
      }
      if (dObj && !isNaN(dObj.getTime())) {
        const tz = (typeof CONFIG !== 'undefined') ? CONFIG.TIMEZONE : "Asia/Bangkok";
        return {
          date: Utilities.formatDate(dObj, tz, "yyyy-MM-dd"),
          time: Utilities.formatDate(dObj, tz, "HH:mm"),
          obj: dObj
        };
      }
      return { date: null, time: null, obj: null };
    },
    formatDateTime: function (val, type) {
      const parsed = this.parseCustomDateTime(val);
      if (!parsed.obj) return "";
      return type === 'date' ? parsed.date : parsed.time;
    }
  };
})();

// =================================================================
// 🌐 ROUTER
// =================================================================
function doGet(e) { return HtmlService.createTemplateFromFile('src/frontend/index').evaluate().setTitle("Shift Report").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); }
function include(filename) { return HtmlService.createHtmlOutputFromFile(filename).getContent(); }

function apiHandler(request) {
  const { func, data } = request;
  const apiMap = {
    // Ticket Core
    'getTickets': () => TicketController.getTickets(false),
    'createTicket': (d) => TicketController.createTicket(d),
    'updateTicket': (d) => TicketController.updateTicket(d),
    'deleteTicket': (id) => TicketController.deleteTicket(id),
    'getTicketConfig': () => TicketController.getTicketConfig(),

    // Match Core
    'apiGetWorkList': () => MatchController.apiGetWorkList(),
    'apiCreateWorkItem': (d) => MatchController.apiCreateWorkItem(d),
    'apiUpdateWorkItem': (d) => MatchController.apiUpdateWorkItem(d),
    'apiDeleteWorkItem': (d) => MatchController.apiDeleteWorkItem(d),
    'apiStopWorkItem': (d) => MatchController.apiStopWorkItem(d),
    'getCalendarEvents': (d) => MatchController.apiGetCalendarEvents(d),
    'apiGetCalendarEvents': (d) => MatchController.apiGetCalendarEvents(d),

    // Report Page Logic (Refactored)
    'getTicketDetails': (d) => TicketService.getTicketDetails(d),
    'getMatchesByDate': (d) => MatchService.getMatchesByDate(d),
    'getVerificationReport': (d) => MatchService.getVerificationReport(d),
    'processShiftReport': (d) => ReportController.processShiftReport(d),
    'getShiftHistory': () => ReportController.getShiftHistory(),
    'getDailyProofImages': (d) => ReportController.getDailyProofImages(d),

    'getMasterTeamList': () => API_UTILS.createRes(true, [])
  };

  if (apiMap[func]) { try { return apiMap[func](data); } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); } }
  return JSON.stringify({ success: false, error: "Function not found" });
}

// Global Delegates (Legacy Support)
function getTickets(f) { return TicketController.getTickets(f); }
function createTicket(d) { return TicketController.createTicket(d); }
function updateTicket(d) { return TicketController.updateTicket(d); }
function deleteTicket(id) { return TicketController.deleteTicket(id); }
function getTicketConfig() { return TicketController.getTicketConfig(); }
function saveTicketConfig(d) { return TicketController.saveTicketConfig(d); }
function apiGetWorkList() { return MatchController.apiGetWorkList(); }
function apiCreateWorkItem(d) { return MatchController.apiCreateWorkItem(d); }
function apiUpdateWorkItem(d) { return MatchController.apiUpdateWorkItem(d); }
function apiDeleteWorkItem(d) { return MatchController.apiDeleteWorkItem(d); }
function apiStopWorkItem(d) { return MatchController.apiStopWorkItem(d); }
function apiGetCalendarEvents(d) { return MatchController.apiGetCalendarEvents(d); }
function getMatches() { return MatchController.apiGetWorkList(); }
function getUserSettings() { return JSON.stringify({ theme: "light", profile: { email: Session.getActiveUser().getEmail(), role: "Admin" } }); }
