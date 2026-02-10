/**
 * Standard API Response Helper
 * Provides consistent JSON response structure for all backend services.
 */
const Response = {
  /**
   * Returns a success response
   * @param {any} data - The payload to return
   * @return {string} JSON string
   */
  success: function (data) {
    return JSON.stringify({ success: true, data: data });
  },

  /**
   * Returns an error response
   * @param {string} message - Error message
   * @param {any} debugInfo - Optional debug info
   * @return {string} JSON string
   */
  error: function (message, debugInfo = null) {
    return JSON.stringify({ success: false, error: message, debug: debugInfo });
  }
};
