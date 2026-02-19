function doGet(e) {
  try {
    return HtmlService.createTemplateFromFile('frontend/index')
      .evaluate()
      .setTitle('NOC APP')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) {
    return HtmlService.createHtmlOutput('<h2>Error loading app</h2><p>' + error.message + '</p>');
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* 1. API สำหรับดึงข้อมูลผู้ใช้ปัจจุบัน (ชื่อ, รูป, อีเมล) */
function getCurrentUser() {
  try {
    const email = Session.getActiveUser().getEmail();
    let name = "";
    let picture = "";

    // พยายามดึงชื่อจาก People API (ต้องเปิด Service 'People API' ก่อน)
    try {
      const profile = People.People.get('people/me', { personFields: 'names,photos' });
      
      if (profile.names && profile.names.length > 0) {
        name = profile.names[0].displayName;
      }
      if (profile.photos && profile.photos.length > 0) {
        picture = profile.photos[0].url;
      }
    } catch (e) {
      // กรณีไม่ได้เปิด People API หรือ Error -> ใช้ Fallback แปลงชื่อจากอีเมลแทน
      if (!name) {
        const parts = email.split('@')[0].split('.');
        name = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
      }
    }

    // ถ้ายังไม่มีชื่อ ให้ใช้ User ทั่วไป
    if (!name) name = "User";

    return { email: email, name: name, picture: picture };
  } catch (e) {
    return { email: "user@example.com", name: "Guest", picture: "" };
  }
}

/* 3. Trigger Function (สำหรับ Spreadsheet OnChange) */
function onSheetEdit(e) {
  NotificationService.triggerUpdate();
}

/* 4. Trigger Function (สำหรับตั้งเวลา Auto Sync Gmail) */
function autoSyncGmail() {
  try {
    // ✅ แก้ไข: ดึงข้อมูลและเซฟแบบอัตโนมัติ ตาม Flow ของ GmailService ใหม่
    const res = GmailService.getUnsyncedEmails();
    
    if (res && res.success && res.items && res.items.length > 0) {
      // คัดกรองเอาเฉพาะรายการที่พร้อมจะสร้างใหม่ (READY) หรืออัปเดต ID (UPDATE_SVR)
      const validItems = res.items.filter(item => item.status === 'READY' || item.status === 'UPDATE_SVR');
      const payloadsToSave = validItems.map(item => item.payload);
      
      if (payloadsToSave.length > 0) {
        const saveRes = GmailService.saveBatchTickets(payloadsToSave);
        console.log(`Auto-Sync Success: Saved ${saveRes.count} tickets.`);
      } else {
        console.log("Auto-Sync: No valid tickets to save.");
      }
    }
  } catch (e) {
    console.error("Auto Sync Error: ", e);
  }
}
