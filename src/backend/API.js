// =================================================================
// 🔧 UTILITIES (Shared)
// =================================================================
const API_UTILS = (() => {
  const getDbId = () =>
    typeof CONFIG !== "undefined"
      ? CONFIG.DB_ID
      : PropertiesService.getScriptProperties().getProperty("CORE_SHEET_ID");

  return {
    getDbSheet: function () {
      const dbId = getDbId();
      if (!dbId) throw new Error("DB_ID is missing.");
      const tabName =
        typeof CONFIG !== "undefined" && CONFIG.MATCH_TAB
          ? CONFIG.MATCH_TAB
          : "DB_Matches";
      return SpreadsheetApp.openById(dbId).getSheetByName(tabName);
    },
    createRes: function (s, d) {
      return JSON.stringify(
        s ? { success: true, data: d } : { success: false, message: d },
      );
    },
    getHeaderMap: function (sheet) {
      const headers = sheet
        .getRange(1, 1, 1, sheet.getLastColumn())
        .getValues()[0];
      return headers.reduce(
        (acc, colName, idx) => {
          acc[colName.toLowerCase().trim()] = idx;
          return acc;
        },
        { _headers: headers },
      );
    },
    parseCustomDateTime: function (val) {
      if (!val) return { date: null, time: null, obj: null };
      const strVal = String(val).trim();
      if (strVal === "" || strVal === "-")
        return { date: null, time: null, obj: null };
      let dObj = null;
      const dmy = strVal.match(
        /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/,
      );
      if (dmy) {
        dObj = new Date(
          `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}T${(dmy[4] || "00").padStart(2, "0")}:${(dmy[5] || "00").padStart(2, "0")}:00`,
        );
      } else {
        const ymd = strVal.match(
          /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/,
        );
        if (ymd) {
          dObj = new Date(
            `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}T${(ymd[4] || "00").padStart(2, "0")}:${(ymd[5] || "00").padStart(2, "0")}:00`,
          );
        } else {
          dObj = new Date(val);
        }
      }
      if (dObj && !isNaN(dObj.getTime())) {
        const tz =
          typeof CONFIG !== "undefined" ? CONFIG.TIMEZONE : "Asia/Bangkok";
        return {
          date: Utilities.formatDate(dObj, tz, "yyyy-MM-dd"),
          time: Utilities.formatDate(dObj, tz, "HH:mm"),
          obj: dObj,
        };
      }
      return { date: null, time: null, obj: null };
    },
    formatDateTime: function (val, type) {
      const parsed = this.parseCustomDateTime(val);
      if (!parsed.obj) return "";
      return type === "date" ? parsed.date : parsed.time;
    },
  };
})();

// =================================================================
// 🌐 ROUTER (Centralized API Handler)
// =================================================================
function apiHandler(request) {
  const { func, data } = request;

  const apiMap = {
    // Ticket Core
    getTickets: () => TicketController.getTickets(false),
    createTicket: (d) => TicketController.createTicket(d),
    updateTicket: (d) => TicketController.updateTicket(d),
    deleteTicket: (id) => TicketController.deleteTicket(id),
    createTicketAndDraft: (d) => TicketController.createTicketAndDraft(d),

    // Unified Settings
    apiResetSettings: () => SettingController.resetSettingSheets(),
    apiGetAllSettings: () => SettingController.apiGetAllSettings(),
    apiSaveAllSettings: (d) => SettingController.apiSaveAllSettings(d),

    updateTicketIdOnly: (d) => TicketController.updateTicketIdOnly(d.oldId, d.newId),

    // Gmail & Import
    getEmailPreviews: () => GmailService.getUnsyncedEmails(),
    saveBatchTickets: (d) => GmailService.saveBatchTickets(d),
    apiCreateDraftEmail: (d) => GmailService.createDraftTicket(d),

    // Match Core
    apiGetWorkList: (d) => MatchController.apiGetWorkList(d),
    apiCreateWorkItem: (d) => MatchController.apiCreateWorkItem(d),
    apiUpdateWorkItem: (d) => MatchController.apiUpdateWorkItem(d),
    apiDeleteWorkItem: (d) => MatchController.apiDeleteWorkItem(d),
    apiStopWorkItem: (d) => MatchController.apiStopWorkItem(d),
    apiSaveChecklist: (d) => MatchController.apiSaveChecklist(d),
    getCalendarEvents: (d) => MatchController.apiGetCalendarEvents(d),
    apiGetCalendarEvents: (d) => MatchController.apiGetCalendarEvents(d),
    apiCheckMatchUpdate: (d) => MatchController.apiCheckMatchUpdate(d),

    // ✨ Shift Handover
    getHandovers: () => HandoverController.getHandovers(),
    createHandover: (d) => HandoverController.createHandover(d),
    updateHandover: (d) => HandoverController.updateHandover(d),
    deleteHandover: (id) => HandoverController.deleteHandover(id),
    resolveHandover: (id) => HandoverController.resolveHandover(id),
    acknowledgeHandover: (d) => HandoverController.acknowledgeHandover(d),

    // ✨ Service Playbook
    getPlaybooks: () => PlaybookController.getPlaybooks(),
    savePlaybook: (d) => PlaybookController.savePlaybook(d),
    deletePlaybook: (id) => PlaybookController.deletePlaybook(id),
    uploadImage: (d) => PlaybookController.uploadImage(d.base64Data, d.fileName),

    // Report Page Logic
    getTicketDetails: (d) => TicketService.getTicketDetails(d),
    getMatchesByDate: (d) => MatchService.getMatchesByDate(d),
    getVerificationReport: (d) => MatchService.getVerificationReport(d),
    processShiftReport: (d) => ReportController.processShiftReport(d),
    getShiftHistory: () => ReportController.getShiftHistory(),
    getDailyProofImages: (d) => ReportController.getDailyProofImages(d),

    // Master & Config
    getMasterTeamList: () => API_UTILS.createRes(true, []),

    // User Settings (ดึงข้อมูล Profile กลับไปให้ Frontend)
    getUserSettings: () => {
      const email = Session.getActiveUser().getEmail();
      return JSON.stringify({
        theme: "light",
        profile: {
          email: email,
          role: "Guest", // Default role
        },
      });
    },

    // Routine Profiles
    saveRoutineProfile: (d) => RoutineProfileController.saveRoutineProfile(d.profileName, d.formData),
    getRoutineProfiles: () => RoutineProfileController.getRoutineProfiles(),
    deleteRoutineProfile: (d) => RoutineProfileController.deleteRoutineProfile(d.profileName),
    setAutoLoadRoutineProfile: (d) => RoutineProfileController.setAutoLoad(d.profileName, d.isEnabled),
  };

  if (apiMap[func]) {
    try {
      const result = apiMap[func](data);
      return typeof result === "object" ? JSON.stringify(result) : result;
    } catch (e) {
      return JSON.stringify({ success: false, error: e.toString() });
    }
  }
  return JSON.stringify({
    success: false,
    error: "Function not found: " + func,
  });
}