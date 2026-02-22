/**
 * src/backend/controllers/AuthController.js
 * Security: Whitelist email check (Session vs Owner)
 */
const AuthController = (() => {
  return {
    verifyUser: function () {
      try {
        const activeUser = Session.getActiveUser().getEmail().toLowerCase();
        const ownerUser = Session.getEffectiveUser().getEmail().toLowerCase();

        // 1. ระบุตัวตน (ดึงจากคนที่ใช้งานอยู่ตอนนี้ หรือเจ้าของ Script)
        const currentUser = activeUser || ownerUser;
        if (!currentUser) {
          return {
            success: false,
            message: "ไม่สามารถระบุตัวตนได้ กรุณาล็อกอิน Google Account",
          };
        }

        // 2. Owner Bypass: เจ้าของสคริปต์เข้าใช้งานได้เสมอ (มีประโยชน์ตอนทดสอบ)
        if (currentUser === ownerUser) {
          return { success: true, email: currentUser, role: "Owner" };
        }

        // 3. Whitelist Check จากชีต Setting_Users
        const dbId =
          typeof CONFIG !== "undefined"
            ? CONFIG.DB_ID
            : PropertiesService.getScriptProperties().getProperty(
                "CORE_SHEET_ID",
              );
        const sheet =
          SpreadsheetApp.openById(dbId).getSheetByName("Setting_Users");
        if (!sheet)
          return {
            success: false,
            message: "ไม่พบฐานข้อมูล Whitelist (Setting_Users)",
          };

        const data = sheet.getDataRange().getValues();
        // วนลูปเช็คอีเมล (ไม่ต้องสน Password แล้ว)
        for (let i = 1; i < data.length; i++) {
          const dbEmail = String(data[i][0]).trim().toLowerCase();
          const dbName = data[i][2] || "User"; // สมมติว่าคอลัมน์ C คือ ชื่อ/Role

          if (dbEmail === currentUser) {
            return { success: true, email: currentUser, userName: dbName };
          }
        }

        return {
          success: false,
          message: "Access Denied: อีเมลของคุณไม่อยู่ในระบบ (Whitelist)",
        };
      } catch (e) {
        return { success: false, message: "Auth Error: " + e.toString() };
      }
    },
  };
})();
