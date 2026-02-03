const http = require('http');
const fs = require('fs');
const path = require('path');

// ⚙️ CONFIGURATION
const SRC_DIR = './src';
const PORT = 3000;

// ==========================================
// 1. MOCK DATA (ข้อมูลจำลอง)
// ==========================================

// ข้อมูลสำหรับ Dashboard
const MOCK_MATCHES_DASHBOARD = [
  { id: '101', date: '2026-02-03', time: '17:00', home: 'Buriram Utd', away: 'Port FC', league: 'THAI LEAGUE', statusIn: 'WAIT', statusOut: 'WAIT', signalOwner: 'HOST', channel: 'TS-HD2' },
  { id: '102', date: '2026-02-03', time: '19:30', home: 'Man Utd', away: 'Man City', league: 'EPL', statusIn: 'DONE', statusOut: 'WAIT', signalOwner: 'RECEIVE', channel: 'TPF-1' },
  { id: '103', date: '2026-02-03', time: '21:00', home: 'Liverpool', away: 'Arsenal', league: 'EPL', statusIn: 'DONE', statusOut: 'DONE', signalOwner: 'HOST', channel: 'TPF-1' }
];

// ข้อมูลประวัติ Shift Report
const MOCK_HISTORY_LOGS = [
  { date: "03/02/2026", name: "เมฆินทร์", pdfUrl: "#" },
  { date: "02/02/2026", name: "อรรคพล", pdfUrl: "#" },
  { date: "01/02/2026", name: "วัชระพล", pdfUrl: "#" }
];

// ข้อมูลประวัติการใช้งานทั่วไป (Dashboard History)
const MOCK_SYSTEM_LOGS = {
  data: [
    { id: 'LOG-001', timestamp: '2026-02-03T10:00:00Z', actor: 'Admin', action: 'CHECK_IN', details: 'Man Utd vs Man City', ip: '127.0.0.1' },
    { id: 'LOG-002', timestamp: '2026-02-03T09:45:00Z', actor: 'System', action: 'AUTO_UPDATE', details: 'Sync Match Data', ip: '::1' }
  ],
  pagination: { page: 1, totalPages: 5, totalItems: 15 }
};

// ==========================================
// 2. CLIENT MOCK SCRIPT
// ==========================================
const CLIENT_MOCK_SCRIPT = `
<script>
  console.warn('%c⚠️ RUNNING IN LOCAL DEV MODE', 'background: #ffcc00; color: #000; padding: 4px; font-weight: bold; border-radius: 4px;');
  
  window.google = {
    script: {
      get run() {
        return {
          _success: null,
          _failure: null,
          
          withSuccessHandler: function(cb) { this._success = cb; return this; },
          withFailureHandler: function(cb) { this._failure = cb; return this; },

          // ========================================================
          // 🟢 1. DASHBOARD SYSTEM
          // ========================================================
          getMatches: function(viewMode, filterValue) {
            console.log('[Mock] 📺 getMatches:', viewMode, filterValue);
            const self = this;
            setTimeout(() => {
               self._success && self._success(JSON.stringify(${JSON.stringify(MOCK_MATCHES_DASHBOARD)}));
            }, 600);
          },

          toggleSignalOwner: function(id, next) {
             console.log('[Mock] 🔄 toggleSignal:', id, next);
             const self = this;
             setTimeout(() => self._success && self._success(JSON.stringify({success:true})), 500);
          },

          setMatchStatus: function(id, type) {
             console.log('[Mock] ✅ setMatchStatus:', id, type);
             const self = this;
             setTimeout(() => self._success && self._success(JSON.stringify({success:true})), 500);
          },

          getReportStats: function(m) {
             console.log('[Mock] 📊 getReportStats');
             const self = this;
             setTimeout(() => {
                const stats = { total: 45, completed: 30, pending: 15, signals: { 'HOST': 25, 'RECEIVE': 20 }, daily: { "01": 2, "02": 3, "03": 4 } };
                self._success && self._success(JSON.stringify(stats));
             }, 600);
          },

          // ========================================================
          // 🟢 2. SHIFT REPORT SYSTEM
          // ========================================================
          
          // ดึงข้อมูล Ticket จาก Sheet (จำลอง)
          getTicketDetails: function(date) {
             console.log('[Mock] 🎫 getTicketDetails:', date);
             const self = this;
             setTimeout(() => {
                const res = {
                   success: true,
                   text: "Total: 5\\nNew: 2\\nSucceed: 2\\nPending: 1\\n\\n[SUCCEED] INC-123 - Server Down\\n[PENDING] INC-124 - Network Slow",
                   rawStats: { total: 5, newTicket: 2, succeed: 2, pending: 1 },
                   rawDetails: "[SUCCEED] INC-123...\\n[PENDING] INC-124..."
                };
                self._success && self._success(res);
             }, 800);
          },

          // ดึงข้อมูล Match สรุปรายวัน (สำหรับ Report)
          getMatchesByDate: function(date) {
             console.log('[Mock] ⚽ getMatchesByDate (Report):', date);
             const self = this;
             setTimeout(() => {
                const res = {
                   success: true,
                   text: "(Match รวม 3 คู่ )\\n\\nPremier League: 2\\nThai League 1: 1",
                   data: { "Premier League": 2, "Thai League 1": 1 },
                   total: 3
                };
                self._success && self._success(res);
             }, 800);
          },

          // ส่ง Form Report (Draft/Real)
          processShiftReport: function(formData) {
             console.log('[Mock] 📝 processShiftReport:', formData);
             const self = this;
             setTimeout(() => {
                const res = {
                   success: true,
                   isPreview: formData.isDraft, 
                   pdfUrl: "#", 
                   chatPreview: "*Mock Chat Message*\\nDate: " + formData.date + "\\nReporter: " + formData.reporter
                };
                // Backend ปกติจะส่ง JSON String กลับมา
                self._success && self._success(JSON.stringify(res));
             }, 1500);
          },

          // ดึงประวัติ Shift Report
          getShiftHistory: function() {
             console.log('[Mock] 📜 getShiftHistory');
             const self = this;
             setTimeout(() => {
                self._success && self._success(JSON.stringify(${JSON.stringify(MOCK_HISTORY_LOGS)}));
             }, 600);
          },

          // ========================================================
          // 🟢 3. GENERAL HISTORY & LOGS
          // ========================================================
          getHistory: function(page, pageSize, search) {
             console.log('[Mock] 🕰️ getHistory (Logs):', page, search);
             const self = this;
             setTimeout(() => {
                self._success && self._success(JSON.stringify(${JSON.stringify(MOCK_SYSTEM_LOGS)}));
             }, 600);
          },

          // ========================================================
          // 🟢 4. EMAIL SYSTEM
          // ========================================================
          getEmailTemplates: function() {
             console.log('[Mock] 📧 getEmailTemplates');
             const self = this;
             setTimeout(() => {
                const templates = [
                  { id: 'DAILY_SUMMARY', name: 'Daily Operation Summary' },
                  { id: 'INCIDENT_REPORT', name: 'Incident / Issue Report' },
                  { id: 'SHIFT_HANDOVER', name: 'Shift Handover Note' }
                ];
                self._success && self._success(JSON.stringify(templates));
             }, 400);
          },

          getEmailPreview: function(id, note) {
             console.log('[Mock] 👁️ getEmailPreview:', id);
             const self = this;
             setTimeout(() => {
                const res = { subject: "[Mock] " + id, body: "<p>Mock Body Content: " + note + "</p>" };
                self._success && self._success(JSON.stringify(res));
             }, 600);
          },

          createDraftEmail: function(id, to, cc, note) {
             console.log('[Mock] 📨 createDraftEmail:', {id, to});
             const self = this;
             setTimeout(() => {
                self._success && self._success(JSON.stringify({ success: true, message: "Draft Created in Gmail" }));
             }, 1200);
          },

          // ========================================================
          // 🟢 5. SETTINGS & PROFILE
          // ========================================================
          getUserSettings: function() {
             console.log('[Mock] ⚙️ getUserSettings');
             const self = this;
             setTimeout(() => self._success && self._success(JSON.stringify({
                theme: 'light',
                profile: { name: 'Admin User', role: 'Super Admin' },
                notifications: { email: true, line: false }
             })), 400);
          },
          
          saveUserSettings: function(settings) {
             console.log('[Mock] 💾 saveUserSettings:', settings);
             const self = this;
             setTimeout(() => self._success && self._success(JSON.stringify({ success: true })), 800);
          }
        };
      }
    }
  };
</script>
`;

// ==========================================
// 3. SERVER LOGIC
// ==========================================
function processTemplate(filePath) {
  if (!fs.existsSync(filePath)) return ``;
  let content = fs.readFileSync(filePath, 'utf8');
  // Handle server-side includes recursively
  return content.replace(/<\?!= include\('(.*?)'\); \?>/g, (match, includePath) => {
    const name = includePath.endsWith('.html') ? includePath : includePath + '.html';
    const fullPath = path.join(SRC_DIR, name);
    return processTemplate(fullPath);
  });
}

http.createServer((req, res) => {
  if (req.url === '/') {
    try {
      // Find index.html
      let indexPath = path.join(SRC_DIR, 'frontend/index.html');
      if (!fs.existsSync(indexPath)) indexPath = path.join(SRC_DIR, 'Index.html'); // Fallback

      if (!fs.existsSync(indexPath)) throw new Error(`Cannot find index.html in ${SRC_DIR}`);

      // Process content
      let html = processTemplate(indexPath);

      // Inject Mock Script
      html = html.replace('</body>', `${CLIENT_MOCK_SCRIPT}</body>`);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end(`<h1>Server Error</h1><p>${err.message}</p>`);
      console.error(err);
    }
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
}).listen(PORT, () => {
  console.log(`\n🚀 Local Server running at http://localhost:${PORT}`);
  console.log(`📂 Serving files from: ${SRC_DIR}`);
});