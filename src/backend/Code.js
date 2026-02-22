/**
 * ตรวจสอบความถูกต้องของ User จาก Google Sheet (Whitelist)
 * เปลี่ยนจากรับ Email/Password เป็นการเช็ค Session อัตโนมัติ
 */
function apiLogin() {
  // เรียกใช้งานระบบ Whitelist จาก AuthController
  const authStatus = AuthController.verifyUser();

  if (authStatus.success) {
    return {
      success: true,
      userName: authStatus.userName || authStatus.role || "User",
      userEmail: authStatus.email,
    };
  } else {
    return { success: false, message: authStatus.message };
  }
}
