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

  // ✨ [SECURITY] Middleware Check: ตรวจสอบสิทธิ์ก่อนเข้าถึงระบบหลังบ้านทุกครั้ง
  const auth = AuthController.verifyUser();
  if (!auth.success && func !== "getUserSettings") {
    // บล็อกการทำงานทันทีหากไม่อยู่ใน Whitelist
    return JSON.stringify({
      success: false,
      error: "403 Forbidden: " + auth.message,
    });
  }

  const apiMap = {
    // Ticket Core
    getTickets: () => TicketController.getTickets(false),
    createTicket: (d) => TicketController.createTicket(d),
    updateTicket: (d) => TicketController.updateTicket(d),
    deleteTicket: (id) => TicketController.deleteTicket(id),
    getTicketConfig: () => TicketController.getTicketConfig(),
    saveTicketConfig: (d) => TicketController.saveTicketConfig(d),
    getEmailProfiles: () => TicketController.getEmailProfiles(),
    saveEmailProfiles: (d) => TicketController.saveEmailProfiles(d),
    getEmailDrafts: (d) => TicketController.getEmailDrafts(d),
    saveEmailDrafts: (d) => TicketController.saveEmailDrafts(d),
    getMailDrafts: (d) => TicketController.getMailDrafts(d),
    saveMailDrafts: (d) => TicketController.saveMailDrafts(d),
    createTicketAndDraft: (d) => TicketController.createTicketAndDraft(d),
    getStaffAndAssignees: () => TicketController.getStaffAndAssignees(),
    saveStaffAndAssignees: (d) => TicketController.saveStaffAndAssignees(d),

    // Gmail & Import
    getEmailPreviews: () => GmailService.getUnsyncedEmails(),
    saveBatchTickets: (d) => GmailService.saveBatchTickets(d),

    // Match Core
    apiGetWorkList: (d) => MatchController.apiGetWorkList(d),
    apiCreateWorkItem: (d) => MatchController.apiCreateWorkItem(d),
    apiUpdateWorkItem: (d) => MatchController.apiUpdateWorkItem(d),
    apiDeleteWorkItem: (d) => MatchController.apiDeleteWorkItem(d),
    apiStopWorkItem: (d) => MatchController.apiStopWorkItem(d),
    getCalendarEvents: (d) => MatchController.apiGetCalendarEvents(d),
    apiGetCalendarEvents: (d) => MatchController.apiGetCalendarEvents(d),
    apiCheckMatchUpdate: (d) => MatchController.apiCheckMatchUpdate(d), // เพิ่ม Polling ของรอบที่แล้ว

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
    getUserSettings: () =>
      JSON.stringify({
        theme: "light",
        profile: {
          email: auth.email || Session.getActiveUser().getEmail(),
          role: auth.role || auth.userName || "Guest",
        },
      }),
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
