function doGet(e) {
  try {
    return HtmlService.createTemplateFromFile('frontend/index')
      .evaluate()
      .setTitle('GAS SPA App')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) {
    return HtmlService.createHtmlOutput('<h2>Error loading app</h2><p>' + error.message + '</p>');
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
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