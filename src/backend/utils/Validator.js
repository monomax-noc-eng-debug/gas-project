/**
 * src/backend/utils/Validator.js
 * Centralized Input Validation Utility for all Backend Controllers
 */
const Validator = (() => {
  return {
    /**
     * ตรวจสอบว่า payload มี field ที่จำเป็นครบหรือไม่
     * @param {Object} payload - ข้อมูลที่รับมา
     * @param {string[]} requiredFields - รายชื่อ field ที่ต้องมี
     * @returns {{ valid: boolean, message?: string }}
     */
    require: function (payload, requiredFields) {
      if (!payload || typeof payload !== 'object') {
        return { valid: false, message: 'Payload is missing or invalid (expected object)' };
      }
      for (var i = 0; i < requiredFields.length; i++) {
        var field = requiredFields[i];
        var val = payload[field];
        if (val === undefined || val === null || String(val).trim() === '') {
          return { valid: false, message: 'Required field is missing: "' + field + '"' };
        }
      }
      return { valid: true };
    },

    /**
     * ตรวจสอบว่า value เป็น Array และไม่ว่าง (optional: ตรวจขนาด)
     * @param {*} val
     * @param {boolean} allowEmpty - ถ้า true = ยอมให้ Array ว่างได้
     * @returns {boolean}
     */
    isArray: function (val, allowEmpty) {
      if (!Array.isArray(val)) return false;
      if (!allowEmpty && val.length === 0) return false;
      return true;
    },

    /**
     * ตรวจสอบว่า value เป็น string ที่ไม่ว่าง
     * @param {*} val
     * @returns {boolean}
     */
    isNonEmptyString: function (val) {
      return typeof val === 'string' && val.trim() !== '';
    },

    /**
     * ตรวจว่าเป็น ID ที่ Valid (ไม่ null/undefined/empty)
     * @param {*} val
     * @returns {{ valid: boolean, message?: string }}
     */
    requireId: function (val) {
      if (val === undefined || val === null || String(val).trim() === '') {
        return { valid: false, message: 'ID is required and must not be empty' };
      }
      return { valid: true };
    },
  };
})();
