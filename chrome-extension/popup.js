document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggle-btn');
  const statusDot = document.getElementById('status-dot');
  const toggleText = document.getElementById('toggle-text');
  
  // 1. โหลดสถานะตอนเปิดหน้าต่าง
  chrome.storage.local.get(['tomcatEnabled'], (res) => {
    const isEnabled = res.tomcatEnabled !== false;
    updateToggleUI(isEnabled);
  });

  // 2. เมื่อคลิกปุ่ม Active ให้ทำการสลับสถานะ
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      chrome.storage.local.get(['tomcatEnabled'], (res) => {
        const newState = !(res.tomcatEnabled !== false);
        chrome.storage.local.set({ tomcatEnabled: newState }); // เซฟค่า
        updateToggleUI(newState);
        
        // อัปเดตกล่อง Tomcat ทันทีที่กด
        const tcStatus = document.getElementById('tc-status');
        if (!newState && tcStatus) {
          tcStatus.innerText = 'Disabled';
          tcStatus.className = 'value warn';
          document.getElementById('tc-rt').innerText = '-- ms';
        } else if (tcStatus) {
          tcStatus.innerText = 'Waiting...';
          tcStatus.className = 'value ok';
        }
      });
    });
  }

  // เปลี่ยนสีปุ่มและข้อความ
  function updateToggleUI(isEnabled) {
    if (isEnabled) {
      statusDot.className = 'status-dot ok-dot';
      toggleText.innerText = 'Active';
    } else {
      statusDot.className = 'status-dot warn-dot';
      toggleText.innerText = 'Paused';
    }
  }

  // 3. ร้องขอข้อมูลทั้งหมดจาก Background
  chrome.runtime.sendMessage({ action: "getLatestData" }, (res) => {
    if (res) {
      if (res.tomcat) updateTomcatUI(res.tomcat);
      if (res.data) updateGrafanaUI(res.data);
      if (res.nextCheckTime) startCountdown(res.nextCheckTime);
    }
  });

  // 4. Countdown timer สำหรับ Tomcat
  let countdownInterval = null;
  function startCountdown(nextCheckTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    
    const countdownEl = document.getElementById('tc-countdown');
    if (!countdownEl) return;

    function updateCountdown() {
      const now = Date.now();
      const remaining = nextCheckTime - now;
      
      if (remaining <= 0) {
        countdownEl.innerText = 'กำลังเช็ค...';
        return;
      }
      
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      countdownEl.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
  }
});

function updateTomcatUI(tc) {
  chrome.storage.local.get(['tomcatEnabled'], (res) => {
    const statusEl = document.getElementById('tc-status');
    const rtEl = document.getElementById('tc-rt');
    const timeEl = document.getElementById('tc-time');

    if (res.tomcatEnabled === false) {
      if (statusEl) { statusEl.innerText = 'Disabled'; statusEl.className = 'value warn'; }
      return;
    }

    if (statusEl) {
      statusEl.innerText = tc.isOnline ? `Online (${tc.statusCode})` : `Offline (${tc.statusCode})`;
      statusEl.className = `value ${tc.isOnline ? 'ok' : 'danger'}`;
    }
    if (rtEl) rtEl.innerText = tc.responseTime ? `${tc.responseTime} ms` : '-- ms';
    if (timeEl && tc.timestamp) timeEl.innerText = `${new Date(tc.timestamp).toLocaleTimeString()}`;
  });
}

function updateGrafanaUI(gf) {
  const m = gf.metrics || {};
  
  const stMono = document.getElementById('st-mono');
  const stWww = document.getElementById('st-www');
  if (m.http_status) {
    if (stMono) { stMono.innerText = m.http_status.monomax_me || '--'; stMono.className = `value ${m.http_status.monomax_me == '200' ? 'ok' : 'danger'}`; }
    if (stWww) { stWww.innerText = m.http_status.www_monomax_me || '--'; stWww.className = `value ${m.http_status.www_monomax_me == '200' ? 'ok' : 'danger'}`; }
  }
  
  const drMono = document.getElementById('dr-mono');
  const drWww = document.getElementById('dr-www');
  const drElb = document.getElementById('dr-elb');
  if (m.response_durations) {
    if (drMono) drMono.innerText = m.response_durations.monomax_me ? `${m.response_durations.monomax_me}s` : '--s';
    if (drWww) drWww.innerText = m.response_durations.www_monomax_me ? `${m.response_durations.www_monomax_me}s` : '--s';
    if (drElb) drElb.innerText = m.response_durations.elb_listener_https ? `${m.response_durations.elb_listener_https}s` : '--s';
  }
  
  const er5w = document.getElementById('er-5w');
  const er5v = document.getElementById('er-5v');
  const er4v = document.getElementById('er-4v');
  if (m.error_rate) {
    if (er5w) er5w.innerText = m.error_rate['5xx_www_api'] ? `${m.error_rate['5xx_www_api']}%` : '--';
    if (er5v) er5v.innerText = m.error_rate['5xx_vod'] ? `${m.error_rate['5xx_vod']}%` : '--';
    if (er4v) er4v.innerText = m.error_rate['4xx_vod'] ? `${m.error_rate['4xx_vod']}%` : '--';
  }
  
  const alertBox = document.getElementById('alerts-container');
  const alertList = document.getElementById('alerts-list');
  if (gf.alerts && gf.alerts.length > 0) {
    if (alertBox) alertBox.style.display = 'block';
    if (alertList) alertList.innerHTML = gf.alerts.map(a => `<div class="alert-item">• ${a.message}</div>`).join('');
  } else {
    if (alertBox) alertBox.style.display = 'none';
  }
  
  const gfTime = document.getElementById('gf-time');
  if (gfTime && gf.timestamp) gfTime.innerText = `${new Date(gf.timestamp).toLocaleTimeString()}`;
}