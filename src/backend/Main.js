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

/* 8. API สำหรับดึงข้อมูลผู้ใช้ปัจจุบัน (ชื่อ, รูป, อีเมล) */
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
      // ตัวอย่าง: somchai.j@mono.co.th -> Somchai J
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


/* 1. API สำหรับ Polling (เช็คงานใหม่) */
function checkNewTickets(clientLastCount) {
  return NotificationService.pollingCheck(clientLastCount);
}

/* 2. API สำหรับปุ่ม Manual Fetch */
function manualFetchGmail() {
  return GmailService.syncTickets();
}

/* 3. Trigger Function (สำหรับตั้งเวลา) */
function autoSyncGmail() {
  GmailService.syncTickets();
}

/* 4. Trigger Function (สำหรับ Spreadsheet OnChange) */
function onSheetEdit(e) {
  NotificationService.triggerUpdate();
}

/**
 * src/backend/API.js หรือ Main.js
 * เพิ่ม wrapper function ให้ frontend เรียกได้
 */

function scanEmailDrafts() {
  return TicketController.scanEmailDrafts();
}

function saveEmailDraft(data) {
  return TicketController.saveEmailDraft(data);
}

/* 5. API สำหรับ Ticket & Email Draft */
function createTicketAndDraft(data) {
  return TicketController.createTicketAndDraft(data);
}

/* 6. API สำหรับ Saved Drafts (ฟีเจอร์บันทึกแบบร่าง) */
function getMailDrafts() {
  return TicketController.getMailDrafts();
}

function saveMailDrafts(data) {
  return TicketController.saveMailDrafts(data);
}

/* 7. API สำหรับ Email Profiles (ถ้ามี) */
function getEmailProfiles() {
  return TicketController.getEmailProfiles();
}

function getEmailDrafts() {
  return TicketController.getEmailDrafts();
}