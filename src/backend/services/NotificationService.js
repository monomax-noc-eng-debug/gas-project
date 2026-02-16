/**
 * NotificationService
 * บริการจัดการสถานะการแจ้งเตือนแบบ Lightweight (ใช้ ScriptProperties)
 * เพื่อลดการเรียกใช้ SpreadsheetApp โดยไม่จำเป็น
 */
const NotificationService = (() => {
  const PROP_KEY_COUNT = 'GLOBAL_TICKET_COUNT';
  const PROP_KEY_TIME = 'LAST_UPDATE_TIME';

  return {
    /**
     * เรียกฟังก์ชันนี้เมื่อมีการเปลี่ยนแปลงข้อมูล (เช่น มีเมลเข้า, หรือมีการ Save Ticket)
     * เพื่ออัปเดตตัวเลขล่าสุดลงในหน่วยความจำกลาง
     */
    triggerUpdate: function () {
      try {
        // อ่านจำนวนแถวทั้งหมดจาก Sheet โดยตรง (เพื่อความแม่นยำที่สุด)
        const sheet = TicketController._getTicketSheet();
        const realCount = sheet.getLastRow() - 1; // ลบ Header ออก 1 แถว

        // บันทึกลง Properties
        const props = PropertiesService.getScriptProperties();
        props.setProperties({
          [PROP_KEY_COUNT]: String(realCount),
          [PROP_KEY_TIME]: String(new Date().getTime())
        });

        console.log("Notification Updated: " + realCount);
        return realCount;
      } catch (e) {
        console.warn("Trigger Update Failed", e);
        return 0;
      }
    },

    /**
     * ฟังก์ชันสำหรับหน้าเว็บ (Client) เรียกใช้เพื่อเช็คว่ามีอะไรเปลี่ยนแปลงไหม
     * ทำงานเร็วมาก และกิน Quota น้อย
     */
    pollingCheck: function (clientLastCount) {
      const props = PropertiesService.getScriptProperties();
      const serverCount = parseInt(props.getProperty(PROP_KEY_COUNT) || '0');
      const lastTime = parseInt(props.getProperty(PROP_KEY_TIME) || '0');

      return {
        hasNew: serverCount > clientLastCount,
        serverCount: serverCount,
        diff: serverCount - clientLastCount,
        timestamp: lastTime
      };
    }
  };
})();