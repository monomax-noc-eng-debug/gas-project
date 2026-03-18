/**
 * ดึงข้อมูลสถานะและรายละเอียดเหตุการณ์จาก API, Web Scraping และ RSS Feed
 */
const VendorStatusController = {
  // -------------------------------------------------------------
  // 🔔 Helper Function: ส่งแจ้งเตือนเข้า Google Chat (แบบ Card เน้นสี)
  // -------------------------------------------------------------
  sendChatAlert: function (vendorName, color, message, link) {
    const props = PropertiesService.getScriptProperties();
    const webhookUrl = props.getProperty("CHAT_WEBHOOK_MAIN");

    if (!webhookUrl) return;

    let titleColor = "#10b981"; // Green
    let statusLabel = "Resolved (ทำงานปกติ)";

    if (color === "red") {
      titleColor = "#ef4444"; // Red
      statusLabel = "Outage (ระบบขัดข้อง)";
    } else if (color === "yellow") {
      titleColor = "#f59e0b"; // Yellow
      statusLabel = "Degraded (ระบบล่าช้า/เฝ้าระวัง)";
    }

    const payload = {
      "cardsV2": [
        {
          "cardId": "vendorAlertCard",
          "card": {
            "header": {
              "title": "Vendor Status Update",
              "subtitle": "NOC Monitoring System"
            },
            "sections": [
              {
                "widgets": [
                  {
                    "decoratedText": {
                      "topLabel": "System / Vendor",
                      "text": `<b>${vendorName}</b>`
                    }
                  },
                  {
                    "decoratedText": {
                      "topLabel": "Current Status",
                      "text": `<font color="${titleColor}"><b>${statusLabel}</b></font>`
                    }
                  },
                  {
                    "decoratedText": {
                      "topLabel": "Incident Details",
                      "text": message,
                      "wrapText": true
                    }
                  },
                  {
                    "buttonList": {
                      "buttons": [
                        {
                          "text": "ตรวจสอบหน้าเว็บ",
                          "color": {
                            "red": 0.9,
                            "green": 0.95,
                            "blue": 1.0,
                            "alpha": 1.0
                          },
                          "onClick": {
                            "openLink": {
                              "url": link
                            }
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        }
      ]
    };

    const options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    try {
      UrlFetchApp.fetch(webhookUrl, options);
    } catch (e) {
      console.error("Failed to send Google Chat Alert:", e);
    }
  },

  getVendorStatuses: function (isForce) {
    try {
      const props = PropertiesService.getScriptProperties();

      const lastUpdate = props.getProperty("VENDOR_LAST_UPDATE_TIME");
      const cachedData = props.getProperty("VENDOR_STATUS_DATA");

      if (!isForce && lastUpdate && cachedData) {
        const timeDiff = Date.now() - parseInt(lastUpdate, 10);
        if (timeDiff < 120000) {
          return { success: true, data: JSON.parse(cachedData) };
        }
      }

      let oldStatusMap = {};
      if (cachedData) {
        try {
          const oldArr = JSON.parse(cachedData);
          oldArr.forEach(v => oldStatusMap[v.name] = v.color);
        } catch (e) { }
      }

      const statuses = [];

      const requests = [
        { url: "https://status.mux.com/api/v2/summary.json", muteHttpExceptions: true },
        { url: "https://www.akamaistatus.com/api/v2/summary.json", muteHttpExceptions: true },
        { url: "https://statusgatorstatus.com/", muteHttpExceptions: true },
        { url: "https://status.aws.amazon.com/rss/all.rss", muteHttpExceptions: true }
      ];

      const responses = UrlFetchApp.fetchAll(requests);

      function parseRealStatus(name, response, webUrl) {
        try {
          if (response.getResponseCode() === 200) {
            const data = JSON.parse(response.getContentText());
            const indicator = data.status.indicator || "none";
            let issueMessage = "";
            if (data.incidents && data.incidents.length > 0) {
              issueMessage = data.incidents[0].name;
            } else if (indicator !== "none") {
              issueMessage = data.status.description;
            }

            let color = "green";
            let statusText = "Operational";

            if (indicator === "minor" || indicator === "degraded") {
              color = "yellow"; statusText = "Degraded";
            } else if (indicator === "major" || indicator === "critical") {
              color = "red"; statusText = "Outage";
            }

            return { name: name, status: statusText, color: color, message: issueMessage || "ระบบทำงานปกติ", link: webUrl, type: "Official API" };
          }
        } catch (e) { }
        return { name: name, status: "Fetch Error", color: "red", message: "ไม่สามารถดึงข้อมูล API ได้", link: webUrl, type: "Official API" };
      }

      statuses.push(parseRealStatus("Mux", responses[0], "https://status.mux.com/"));
      statuses.push(parseRealStatus("Akamai", responses[1], "https://www.akamaistatus.com/"));

      try {
        const sgResponse = responses[2];
        if (sgResponse.getResponseCode() === 200) {
          const html = sgResponse.getContentText().toLowerCase();
          let status = "Operational"; let color = "green"; let message = "ระบบทำงานปกติ";

          if (html.includes("all systems are operational") || html.includes("operational")) {
            message = "All systems are operational";
          } else if (html.includes("major outage") || html.includes("critical")) {
            status = "Outage"; color = "red"; message = "พบปัญหาระบบขัดข้อง";
          } else if (html.includes("degraded") || html.includes("partial")) {
            status = "Degraded"; color = "yellow"; message = "พบปัญหาการทำงานบางส่วน";
          }
          statuses.push({ name: "StatusGator", status: status, color: color, message: message, link: "https://statusgatorstatus.com/", type: "Web Scraping" });
        } else {
          statuses.push({ name: "StatusGator", status: "Fetch Error", color: "gray", message: "ไม่สามารถเข้าถึงหน้าเว็บได้", link: "https://statusgatorstatus.com/", type: "Web Scraping" });
        }
      } catch (e) {
        statuses.push({ name: "StatusGator", status: "Fetch Error", color: "gray", message: "เกิดข้อผิดพลาดในการดึงข้อมูล", link: "https://statusgatorstatus.com/", type: "Web Scraping" });
      }

      try {
        const awsResponse = responses[3];
        if (awsResponse.getResponseCode() === 200) {
          const xml = awsResponse.getContentText();
          const document = XmlService.parse(xml);
          const channel = document.getRootElement().getChild('channel');
          const items = channel.getChildren('item');

          let status = "Operational"; let color = "green"; let message = "ระบบทำงานปกติ (Asia Pacific)";
          const apacRegex = /ap-(east|south|northeast|southeast)-\d|asia pacific|singapore|sydney|tokyo|seoul|mumbai|osaka|hong kong|jakarta|melbourne|hyderabad|bangkok|global/i;

          let foundApacItem = null;
          for (let i = 0; i < items.length; i++) {
            let t = items[i].getChild('title').getText();
            if (apacRegex.test(t)) { foundApacItem = items[i]; break; }
          }

          if (foundApacItem) {
            const title = foundApacItem.getChild('title').getText();
            if (title.includes("[RESOLVED]")) {
              message = `แก้ไขแล้ว: ${title.replace(/\[.*?\]\s*/g, '').trim()}`;
            } else if (title.includes("[INFORMATIONAL]")) {
              message = `แจ้งเตือน: ${title.replace(/\[.*?\]\s*/g, '').trim()}`;
            } else {
              status = "Degraded"; color = "yellow"; message = `พบปัญหา: ${title.replace(/\[.*?\]\s*/g, '').trim()}`;
            }
          }
          statuses.push({ name: "AWS (Asia Pacific)", status: status, color: color, message: message, link: "https://health.aws.amazon.com/health/status?path=open-issues", type: "RSS Feed" });
        } else {
          statuses.push({ name: "AWS (Asia Pacific)", status: "Fetch Error", color: "gray", message: "ไม่สามารถดึงข้อมูล RSS ได้", link: "https://health.aws.amazon.com/health/status?path=open-issues", type: "RSS Feed" });
        }
      } catch (e) {
        statuses.push({ name: "AWS (Asia Pacific)", status: "Fetch Error", color: "gray", message: "เกิดข้อผิดพลาดในการดึงข้อมูล RSS", link: "https://health.aws.amazon.com/health/status?path=open-issues", type: "RSS Feed" });
      }

      function fetchNttStatus() {
        const loginUrl = "https://portal.ntt.co.th/auth/login";
        const statusUrl = "https://portal.ntt.co.th/RealTimeStatus";
        const identity = props.getProperty('NTT_USER');
        const password = props.getProperty('NTT_PASS');

        if (!identity || !password) {
          return { name: "NTT Dashboard", status: "Config Error", color: "gray", message: "ยังไม่ได้ตั้งค่ารหัสผ่าน", link: loginUrl, type: "JSON API" };
        }

        try {
          const loginPayload = { "identity": identity, "password": password, "submit": "Log in" };
          const loginResponse = UrlFetchApp.fetch(loginUrl, { method: "post", payload: loginPayload, followRedirects: false, muteHttpExceptions: true });

          let cookie = "";
          const headers = loginResponse.getAllHeaders();
          if (headers['Set-Cookie']) {
            const setCookie = Array.isArray(headers['Set-Cookie']) ? headers['Set-Cookie'] : [headers['Set-Cookie']];
            cookie = setCookie.map(c => c.split(';')[0]).join('; ');
          }

          if (!cookie) return { name: "NTT Dashboard", status: "Login Error", color: "red", message: "เข้าสู่ระบบไม่สำเร็จ", link: loginUrl, type: "JSON API" };

          const statusResponse = UrlFetchApp.fetch("https://portal.ntt.co.th/RealTimeStatus/curl_hostlist", { method: "get", headers: { "Cookie": cookie }, muteHttpExceptions: true });
          const json = JSON.parse(statusResponse.getContentText());
          const hostUp = (json.count && json.count.up !== undefined) ? parseInt(json.count.up) : null;
          const serviceOk = (json.count_service && json.count_service.ok && json.count_service.ok.count !== undefined) ? parseInt(json.count_service.ok.count) : null;

          if (hostUp === null || serviceOk === null) return { name: "NTT Dashboard", status: "Parse Error", color: "yellow", message: "API ไม่ส่งข้อมูลกลับมา", link: statusUrl, type: "JSON API" };

          let status = "Operational", color = "green", message = `ปกติ (Host UP: ${hostUp}/2, Service OK: ${serviceOk}/12)`;
          if (hostUp < 2 || serviceOk < 12) {
            status = (hostUp === 0) ? "Critical Outage" : "Degraded Performance";
            color = (hostUp === 0) ? "red" : "yellow";
            message = `พบความผิดปกติ (Host UP: ${hostUp}/2, Service OK: ${serviceOk}/12)`;
          }

          return { name: "NTT Dashboard", status: status, color: color, message: message, link: statusUrl, type: "JSON API" };
        } catch (e) {
          return { name: "NTT Dashboard", status: "Fetch Error", color: "gray", message: "เกิดข้อผิดพลาดในการดึงข้อมูล", link: statusUrl, type: "JSON API" };
        }
      }
      statuses.push(fetchNttStatus());

      // 🛡️ 1. HTTP Check แบบดั้งเดิม (ยิงรอบเดียวจบ) - สำหรับ Unleash
      function fetchHtmlStatus(name, url) {
        try {
          const start = Date.now();
          const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
          const responseTime = (Date.now() - start) / 1000;
          const code = response.getResponseCode();

          if (code === 200) {
            if (responseTime > 3) {
              return { name: name, status: "Degraded", color: "yellow", message: `เว็บตอบสนองช้า (${responseTime.toFixed(2)} วินาที)`, link: url, type: "HTTP Check" };
            }
            return { name: name, status: "Operational", color: "green", message: `ระบบทำงานปกติ`, link: url, type: "HTTP Check" };
          } else {
            return { name: name, status: "Outage", color: "red", message: `พบปัญหาการเชื่อมต่อ (HTTP Status: ${code})`, link: url, type: "HTTP Check" };
          }
        } catch (e) {
          return { name: name, status: "Outage", color: "red", message: "ไม่สามารถเชื่อมต่อได้ (Timeout)", link: url, type: "HTTP Check" };
        }
      }

      // 🛡️ 2. HTTP Check แบบมีระบบยิงซ้ำ 2 รอบลดความผิดพลาด - สำหรับ Tencent Cloud
      function fetchHtmlStatusWithRetry(name, url) {
        const maxRetries = 2; // ลองยิงสูงสุด 2 ครั้ง

        for (let i = 0; i < maxRetries; i++) {
          try {
            const start = Date.now();
            const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
            const responseTime = (Date.now() - start) / 1000;
            const code = response.getResponseCode();

            if (code === 200) {
              // เพิ่ม Latency ให้ยืดหยุ่นขึ้นสำหรับเซิร์ฟเวอร์ต่างประเทศ (5 วินาที)
              if (responseTime > 5) {
                if (i < maxRetries - 1) {
                  Utilities.sleep(2000); // ถ้าช้า ลองพัก 2 วิแล้วยิงใหม่
                  continue;
                }
                return { name: name, status: "Degraded", color: "yellow", message: `เว็บตอบสนองช้า (${responseTime.toFixed(2)} วินาที)`, link: url, type: "HTTP Check" };
              }
              return { name: name, status: "Operational", color: "green", message: `ระบบทำงานปกติ`, link: url, type: "HTTP Check" };
            } else {
              // ถ้า HTTP ไม่ใช่ 200 (เช่น 500, 503)
              if (i < maxRetries - 1) {
                Utilities.sleep(2000); // พัก 2 วิแล้วลองใหม่
                continue;
              }
              return { name: name, status: "Outage", color: "red", message: `พบปัญหาการเชื่อมต่อ (HTTP Status: ${code})`, link: url, type: "HTTP Check" };
            }
          } catch (e) {
            // ถ้า Timeout หรือยิงไม่เข้าเลย
            if (i < maxRetries - 1) {
              Utilities.sleep(2000);
              continue;
            }
            return { name: name, status: "Outage", color: "red", message: "ไม่สามารถเชื่อมต่อได้ (Timeout)", link: url, type: "HTTP Check" };
          }
        }
      }

      // เรียกใช้ฟังก์ชันที่แบ่งไว้ตามความเหมาะสมของ Vendor
      statuses.push(fetchHtmlStatusWithRetry("Tencent Cloud", "https://status.tencentcloud.com/"));
      statuses.push(fetchHtmlStatus("Unleash Health", "https://unleash.mthcdn.com/health"));

      // -------------------------------------------------------------
      // 🚨 เช็คและส่งแจ้งเตือน
      // -------------------------------------------------------------
      statuses.forEach(v => {
        if (oldStatusMap[v.name]) {
          const oldColor = oldStatusMap[v.name];

          // 1. ถ้าเปลี่ยนมาเป็น สีเหลือง (Degraded) หรือ สีแดง (Outage)
          if ((v.color === 'yellow' || v.color === 'red') && oldColor !== v.color) {
            VendorStatusController.sendChatAlert(v.name, v.color, v.message, v.link);
          }

          // 2. ถ้าซ่อมเสร็จ เปลี่ยนกลับมาเป็น สีเขียว (Resolved)
          if (v.color === 'green' && (oldColor === 'yellow' || oldColor === 'red')) {
            VendorStatusController.sendChatAlert(v.name, "green", "ระบบกลับมาทำงานเป็นปกติแล้ว", v.link);
          }
        }
      });

      // บันทึก Cache
      props.setProperty("VENDOR_STATUS_DATA", JSON.stringify(statuses));
      props.setProperty("VENDOR_LAST_UPDATE_TIME", Date.now().toString());

      return { success: true, data: statuses };

    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getVendorTimelineLogs: function () {
    try {
      let allLogs = [];
      const tz = (typeof CONFIG !== "undefined" && CONFIG.TIMEZONE) ? CONFIG.TIMEZONE : "Asia/Bangkok";
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

      const urls = [
        { name: "Mux", url: "https://status.mux.com/api/v2/incidents.json" },
        { name: "Akamai", url: "https://www.akamaistatus.com/api/v2/incidents.json" }
      ];
      const requests = urls.map(u => ({ url: u.url, muteHttpExceptions: true }));
      const responses = UrlFetchApp.fetchAll(requests);

      responses.forEach((res, index) => {
        if (res.getResponseCode() === 200) {
          try {
            const data = JSON.parse(res.getContentText());
            if (data.incidents) {
              data.incidents.forEach(incident => {
                if (incident.incident_updates) {
                  incident.incident_updates.forEach(update => {
                    if (!update.created_at) return;
                    const updateTime = new Date(update.created_at);
                    if (!isNaN(updateTime.getTime()) && updateTime >= sevenDaysAgo) {
                      allLogs.push({
                        vendorName: urls[index].name,
                        incidentTitle: incident.name,
                        updateBody: update.body,
                        status: update.status,
                        timestamp: updateTime.getTime(),
                        formattedDate: Utilities.formatDate(updateTime, tz, "yyyy-MM-dd"),
                        formattedTime: Utilities.formatDate(updateTime, tz, "HH:mm")
                      });
                    }
                  });
                }
              });
            }
          } catch (e) { }
        }
      });

      try {
        const sgRes = UrlFetchApp.fetch("https://statusgatorstatus.com/", { muteHttpExceptions: true });
        if (sgRes.getResponseCode() === 200) {
          const html = sgRes.getContentText();
          const pastSectionMatch = html.match(/Past Incidents([\s\S]*)/i);
          if (pastSectionMatch && pastSectionMatch[1]) {
            const cleanText = pastSectionMatch[1].replace(/<[^>]+>/g, '\n').split('\n').map(s => s.trim()).filter(s => s.length > 0);
            const dateRegex = /^(\d{1,2}(?:st|nd|rd|th)?)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i;
            let limit = 7;
            for (let i = 0; i < cleanText.length && limit > 0; i++) {
              let line = cleanText[i];
              if (dateRegex.test(line)) {
                let d = new Date(line.replace(/(st|nd|rd|th)/i, ''));
                let incidentText = cleanText[i + 1] || "No incidents reported";
                if (dateRegex.test(incidentText)) { incidentText = "No incidents reported"; i--; } else { i++; }
                if (!isNaN(d.getTime()) && d >= sevenDaysAgo) {
                  let isResolved = incidentText.toLowerCase().includes("no incidents");
                  allLogs.push({
                    vendorName: "StatusGator",
                    incidentTitle: isResolved ? "สถานะระบบปกติ" : "พบรายงานเหตุการณ์",
                    updateBody: incidentText,
                    status: isResolved ? "Resolved" : "Investigating",
                    timestamp: d.getTime(),
                    formattedDate: Utilities.formatDate(d, tz, "yyyy-MM-dd"),
                    formattedTime: "00:00"
                  });
                  limit--;
                }
              }
            }
          }
        }
      } catch (sgErr) { }

      try {
        const awsRes = UrlFetchApp.fetch("https://status.aws.amazon.com/rss/all.rss", { muteHttpExceptions: true });
        if (awsRes.getResponseCode() === 200) {
          const xml = awsRes.getContentText();
          const document = XmlService.parse(xml);
          const channel = document.getRootElement().getChild('channel');
          const items = channel.getChildren('item');

          const apacRegex = /ap-(east|south|northeast|southeast)-\d|asia pacific|singapore|sydney|tokyo|seoul|mumbai|osaka|hong kong|jakarta|melbourne|hyderabad|bangkok|global/i;

          items.forEach(item => {
            const title = item.getChild('title').getText();
            const pubDateStr = item.getChild('pubDate').getText();
            const desc = item.getChild('description').getText();

            if (apacRegex.test(title)) {
              const d = new Date(pubDateStr);
              if (!isNaN(d.getTime()) && d >= sevenDaysAgo) {
                let status = "Investigating";
                if (title.includes("[RESOLVED]")) status = "Resolved";
                else if (title.includes("[INFORMATIONAL]")) status = "Monitoring";

                const cleanTitle = title.replace(/\[.*?\]\s*/g, '');

                allLogs.push({
                  vendorName: "AWS (Asia Pacific)",
                  incidentTitle: cleanTitle.trim(),
                  updateBody: desc,
                  status: status,
                  timestamp: d.getTime(),
                  formattedDate: Utilities.formatDate(d, tz, "yyyy-MM-dd"),
                  formattedTime: Utilities.formatDate(d, tz, "HH:mm")
                });
              }
            }
          });
        }
      } catch (awsErr) { }

      allLogs.sort((a, b) => b.timestamp - a.timestamp);
      return { success: true, data: allLogs };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};