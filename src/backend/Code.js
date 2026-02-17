/**
 * ตรวจสอบความถูกต้องของ User จาก Google Sheet (Sheet ชื่อ Setting_Users)
 */
function apiLogin(email, password) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_ID);
    const sheet = ss.getSheetByName("Setting_Users");
    if (!sheet) return { success: false, message: "ไม่พบฐานข้อมูลผู้ใช้" };

    const data = sheet.getDataRange().getValues();
    const userEmail = String(email).trim().toLowerCase();
    const userPass = String(password).trim();

    for (let i = 1; i < data.length; i++) {
      const dbEmail = String(data[i][0]).trim().toLowerCase();
      const dbPass = String(data[i][1]).trim();
      const dbName = data[i][2];

      if (dbEmail === userEmail && dbPass === userPass) {
        return { 
          success: true, 
          userName: dbName,
          userEmail: dbEmail
        };
      }
    }
    return { success: false, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

