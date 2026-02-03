/**
 * =====================================================
 * ⚙️ 1. รายชื่อปฏิทิน (SOURCE DATA)
 * =====================================================
 */
const CALENDARS_CONFIG_DATA = [
  { name: "Thai League 1", id: "c_918487f65f5c5739c721876b87f751939331e1d76a9b2a87a44f7d5ab0fdc5fb@group.calendar.google.com" },
  { name: "Thai League 2", id: "c_b8f22a45353df455a9c120389cda7a7f957c40e147046f00f25d5c84cb914e56@group.calendar.google.com" },
  { name: "Thai League 3", id: "c_79c532d941b9411dd23a7ff295342a405f1cc775f12eacdca279d0baec8f9981@group.calendar.google.com" },
  { name: "FA Community Shield", id: "c_22bc862fa7327133868c7cb902adab585c9c54cd196db75c3321a4cf2f900ba7@group.calendar.google.com" },
  { name: "Chang FA Cup", id: "c_dec725334113e13203aabffcba5c96d7d70e53e0b4d06f066ff5c2c4b57663c1@group.calendar.google.com" },
  { name: "Thai Women League 2 ", id: "c_7b6c6bdd19adb98bc1ecc7a92766cad25c9c530ad2a506871fb38e6c121acc40@group.calendar.google.com" },
  { name: "Carabao Cup", id: "c_1a4f4806f3c1bb7b811fffee57c62fee3bb2f1157f2c7938f79fd1fe188f189a@group.calendar.google.com" },
  { name: "EFL", id: "c_8f616edef1fa1e59c4eac7d550d3820b378b7ed97238daceab282fa4a4397e3b@group.calendar.google.com" },
  { name: "Premier League", id: "c_81d9d3fb928e9618f923f5f13f103bbef65ea0bf030eb63525fca483d8a7cf41@group.calendar.google.com" },
  { name: "French League", id: "c_06aa510a9a24d9c1f1acb889c204506a089f466c6f4be6d5bc8f26655a1dc587@group.calendar.google.com" },
  { name: "SV League M_Volleyball", id: "c_78fb7dc5522d1b6f9b5d3c9f49f3c445bc75fb6b67ec4ca0d961850c0ad7ea6c@group.calendar.google.com" },
  { name: "SV League WM_Volleyball", id: "c_68067cce9d7061923cf365a97bcb0a9a0f536b17cabc7d6766adaa65221fe225@group.calendar.google.com" },
  { name: "The Emirates FA Cup", id: "c_34607b8d27abaf635e20cab8295ca2289ae7af5f5db03d122f19424f4cce35a7@group.calendar.google.com" },
  { name: "U21", id: "c_d0658b7942360ae53180a9374e476477be6380dde0c4ade64f79e978b6cef0fd@group.calendar.google.com" },
  { name: "UEFA European", id: "c_c26e7b669b3bfe2b3ce13346f32733caf2f33719aab48f03219c5e3306297e47@group.calendar.google.com" },
  { name: "MUANGTHAI CUP", id: "c_404a3c5692d6d5463183dcbadad8dd3c1e1c3efa0997d9360570fe10bc2cd159@group.calendar.google.com" }
];

/**
 * =====================================================
 * 💾 2. SETUP PROPERTIES (รัน 1 ครั้งเพื่อบันทึกค่า)
 * =====================================================
 */
function setupScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  
  // แปลง Array ปฏิทินเป็น JSON String
  const calendarJson = JSON.stringify(CALENDARS_CONFIG_DATA);

  // ID ของ Google Sheet หลัก (Dashboard Database)
  const MAIN_SHEET_ID = '1vSI-pdr-WDQ37bNOD61SQMzqAAJ-a_5o00Av391ZyvM';

  props.setProperties({
    'DB_SHEET_ID': MAIN_SHEET_ID,          // เก็บ ID ไฟล์ Sheet
    'CALENDAR_CONFIG_JSON': calendarJson,  // เก็บ Config ปฏิทิน (แยกคีย์ออกมาต่างหาก)
    
    'TICKET_SHEET_ID': '1Y_o6q78ML6S2Orvkgrgw5QxNaTKN3e6Uj0-tDyiP9LQ',
    'TEMPLATE_DOC_ID': '1vRkb_yvfn2CcwuJ1qrvTwG0Cia1iAGFAFdLHmeKk710',
    'IMG_FOLDER_ID': '1rURdmn4oAc1M5-yA1MXvartb0sx7MIVr',
    'PDF_FOLDER_ID': '17lzzs1PPDpf7FDNjZJokQGDd9ViIsmhg',
    'WEBHOOK_GROUP_ALL': 'https://chat.googleapis.com/v1/spaces/AAQAi6D-iNc/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=ocKCRN5_AEqKrUn28cFV8ej4AAekGvftXUQzrFRKpv0',
    'WEBHOOK_GROUP_DEV': 'https://chat.googleapis.com/v1/spaces/AAQAXuRmBR0/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=QWHrY6S6zy53YFphoHdTphwlwrUp6NLa0IgWy1JQlKo'
  });

  console.log("✅ บันทึก Script Properties เรียบร้อยแล้ว!");
}

/**
 * =====================================================
 * 🏗️ 3. SETUP DATABASE (รัน 1 ครั้งเพื่อสร้าง TAB)
 * =====================================================
 */
function setupDatabase() {
  // ดึง ID จากที่เพิ่งบันทึกไป
  const dbId = PropertiesService.getScriptProperties().getProperty('DB_SHEET_ID');
  
  if (!dbId) {
    console.error("❌ ไม่พบ DB_SHEET_ID กรุณากดรัน setupScriptProperties ก่อนครับ");
    return;
  }

  const ss = SpreadsheetApp.openById(dbId);
  console.log(`📂 เปิดไฟล์: ${ss.getName()}`);

  // 1. Tab: DB_Reports (เก็บประวัติ Shift Report)
  _createSheetIfNotExists(ss, "DB_Reports", [
    "Timestamp", "Report Date", "Shift", "Reporter", 
    "Ticket Total", "Ticket Open", "Ticket Pending", "Ticket Resolved", "Ticket Closed", "Ticket Details",
    "Match Summary", "Match Total", 
    "Transfer Report", "Status Mono", "Status AIS", "Status Start",
    "Image URLs", "PDF Report Link"
  ]);

  // 2. Tab: DB_Matches (เก็บตารางแข่ง)
  _createSheetIfNotExists(ss, "DB_Matches", [
    "Match ID", "Date", "Time", "League", 
    "Home", "Away", "Channel", "Signal", "Status",
    "Image In", "Image Out"
  ]);

  // 3. Tab: DB_Tickets (เก็บ Ticket - ถ้าจะใช้งานแยก)
  _createSheetIfNotExists(ss, "DB_Tickets", [
    "Ticket ID", "Date", "Category", "Issue Detail", "Status", "Owner", "Resolved Time"
  ]);

  // 4. Tab: Config_Data (เก็บค่า Setting Dropdown ต่างๆ)
  _createSheetIfNotExists(ss, "Config_Data", [
    "Type", "Name", "Value"
  ]);

  console.log("🎉 สร้าง Database Structure ครบเรียบร้อยครับ!");
}

/**
 * =====================================================
 * 🔌 4. CONFIG ACCESSOR (Object หลักสำหรับใช้งาน)
 * =====================================================
 */
const CONFIG = (() => {
  const props = PropertiesService.getScriptProperties();
  const calJson = props.getProperty('CALENDAR_CONFIG_JSON');
  
  return {
    DB_ID: props.getProperty('DB_SHEET_ID'),
    TICKET_ID: props.getProperty('TICKET_SHEET_ID'),
    TEMPLATE_ID: props.getProperty('TEMPLATE_DOC_ID'),
    IMG_FOLDER: props.getProperty('IMG_FOLDER_ID'),
    PDF_FOLDER: props.getProperty('PDF_FOLDER_ID'),
    TIMEZONE: 'Asia/Bangkok',
    
    // Helper: ดึงรายการปฏิทินออกมาเป็น Object
    GET_CALENDARS: () => {
      try {
        return calJson ? JSON.parse(calJson) : [];
      } catch (e) {
        console.error("Error parsing calendar config:", e);
        return [];
      }
    },

    WEBHOOKS: {
      "group_all": props.getProperty('WEBHOOK_GROUP_ALL'),
      "group_dev": props.getProperty('WEBHOOK_GROUP_DEV')
    }
  };
})();

/**
 * =====================================================
 * 🛠️ 5. INTERNAL HELPER FUNCTIONS
 * =====================================================
 */

// Helper สำหรับเปิด Sheet ตามชื่อ (ใช้ในโค้ดอื่น)
function _getSheet(tabName) {
  if (!CONFIG.DB_ID) throw new Error("CONFIG.DB_ID is missing");
  var ss = SpreadsheetApp.openById(CONFIG.DB_ID);
  return tabName ? ss.getSheetByName(tabName) : ss;
}

// Helper สำหรับสร้าง Tab ถ้ายังไม่มี (ใช้ใน setupDatabase)
function _createSheetIfNotExists(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
      // จัด Format หัวตาราง
      sheet.getRange(1, 1, 1, headers.length)
           .setFontWeight("bold")
           .setBackground("#c9daf8")
           .setHorizontalAlignment("center");
      
      // ถ้าเป็น Matches ขยายช่องรูป
      if (sheetName === "DB_Matches") {
        sheet.setColumnWidth(10, 150);
        sheet.setColumnWidth(11, 150);
      }
    }
    console.log(`✅ Created Sheet: ${sheetName}`);
  } else {
    console.log(`ℹ️ Sheet Exists: ${sheetName}`);
  }
}