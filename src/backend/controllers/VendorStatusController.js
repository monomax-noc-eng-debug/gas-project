/**
 * ดึงข้อมูลสถานะและรายละเอียดเหตุการณ์จาก API, Web Scraping และ RSS Feed
 */
const VendorStatusController = {
  getVendorStatuses: function (isForce) {
    try {
      const props = PropertiesService.getScriptProperties();

      // ถ้าระบบไม่ได้บังคับโหลดยิงใหม่ และ มีของเดิมที่เซฟไว้ แถมเวลายังไม่เกิน 2 นาที (120000ms) ให้ใช้ของเดิม
      if (!isForce) {
        const lastUpdate = props.getProperty("VENDOR_LAST_UPDATE_TIME");
        const cachedData = props.getProperty("VENDOR_STATUS_DATA");

        if (lastUpdate && cachedData) {
          const timeDiff = Date.now() - parseInt(lastUpdate, 10);
          if (timeDiff < 120000) { // < 2 minutes
            return { success: true, data: JSON.parse(cachedData) };
          }
        }
      }

      const statuses = [];

      // 1. ดึง API มาตรฐาน (Mux, Akamai)
      function fetchRealStatus(name, apiUrl, webUrl) {
        try {
          const response = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });
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
              color = "yellow";
              statusText = "Degraded";
            } else if (indicator === "major" || indicator === "critical") {
              color = "red";
              statusText = "Outage";
            }

            return {
              name: name,
              status: statusText,
              color: color,
              message: issueMessage || "ระบบทำงานปกติ",
              link: webUrl
            };
          }
        } catch (e) { }
        return { name: name, status: "Fetch Error", color: "red", message: "ไม่สามารถดึงข้อมูล API ได้", link: webUrl };
      }

      // 2. ดึง Web Scraper สำหรับ StatusGator
      function fetchStatusGatorScrape(name, url) {
        try {
          const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
          if (response.getResponseCode() === 200) {
            const html = response.getContentText().toLowerCase();
            let status = "Operational"; let color = "green"; let message = "ระบบทำงานปกติ";

            if (html.includes("all systems are operational") || html.includes("operational")) {
              message = "All systems are operational (แสกนจากหน้าเว็บ)";
            } else if (html.includes("major outage") || html.includes("critical")) {
              status = "Outage"; color = "red"; message = "พบปัญหาระบบขัดข้อง (แสกนจากหน้าเว็บ)";
            } else if (html.includes("degraded") || html.includes("partial")) {
              status = "Degraded"; color = "yellow"; message = "พบปัญหาการทำงานบางส่วน (Degraded)";
            }
            return { name: name, status: status, color: color, message: message, link: url };
          }
        } catch (e) { }
        return { name: name, status: "Fetch Error", color: "gray", message: "ไม่สามารถเข้าถึงหน้าเว็บได้", link: url };
      }

      // 3. ดึง AWS RSS พร้อมกรองเฉพาะ Asia Pacific & Global
      function fetchAwsRss() {
        const url = "https://status.aws.amazon.com/rss/all.rss";
        const webLink = "https://health.aws.amazon.com/health/status?path=open-issues";

        try {
          const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
          if (response.getResponseCode() === 200) {
            const xml = response.getContentText();
            const document = XmlService.parse(xml);
            const channel = document.getRootElement().getChild('channel');
            const items = channel.getChildren('item');

            let status = "Operational";
            let color = "green";
            let message = "ระบบทำงานปกติ (เฉพาะโซน Asia Pacific)";

            // 🎯 คีย์เวิร์ดดักจับโซน APAC และระบบ Global ส่วนกลาง
            const apacRegex = /ap-(east|south|northeast|southeast)-\d|asia pacific|singapore|sydney|tokyo|seoul|mumbai|osaka|hong kong|jakarta|melbourne|hyderabad|bangkok|global/i;

            let foundApacItem = null;
            for (let i = 0; i < items.length; i++) {
              let t = items[i].getChild('title').getText();

              // ✨ เช็คเฉพาะหัวข้อ (title) เท่านั้น
              if (apacRegex.test(t)) {
                foundApacItem = items[i];
                break;
              }
            }

            if (foundApacItem) {
              const title = foundApacItem.getChild('title').getText();
              if (title.includes("[RESOLVED]")) {
                message = `แก้ไขแล้ว: ${title.replace(/\[.*?\]\s*/g, '').trim()}`;
              } else if (title.includes("[INFORMATIONAL]")) {
                message = `แจ้งเตือน: ${title.replace(/\[.*?\]\s*/g, '').trim()}`;
              } else {
                status = "Degraded";
                color = "yellow";
                message = `พบปัญหา: ${title.replace(/\[.*?\]\s*/g, '').trim()}`;
              }
            }
            return { name: "AWS (Asia Pacific)", status: status, color: color, message: message, link: webLink };
          }
        } catch (e) { }
        return { name: "AWS (Asia Pacific)", status: "Fetch Error", color: "gray", message: "ไม่สามารถดึงข้อมูล RSS ได้", link: "https://health.aws.amazon.com/health/status?path=open-issues" };
      }

      // 4. ฟังก์ชันเช็ค NTT Portal (Login + Scrape)
      function fetchNttStatus() {
        const loginUrl = "https://portal.ntt.co.th/auth/login";
        const statusUrl = "https://portal.ntt.co.th/RealTimeStatus";
        const props = PropertiesService.getScriptProperties();

        // One-time setup: บันทึก User/Pass ลง Script Properties เพื่อความปลอดภัย
        let identity = props.getProperty('NTT_USER') || "admin@monostreaming";
        let password = props.getProperty('NTT_PASS') || "bP7h7G#85zk";

        if (!props.getProperty('NTT_USER')) {
          props.setProperties({ 'NTT_USER': identity, 'NTT_PASS': password });
        }

        try {
          // 1. Login Phase (POST)
          const loginPayload = {
            "identity": identity,
            "password": password,
            "submit": "Log in"
          };

          const loginResponse = UrlFetchApp.fetch(loginUrl, {
            method: "post",
            payload: loginPayload,
            followRedirects: false, // เราต้องการจับ Cookie ก่อนโดน redirect
            muteHttpExceptions: true
          });

          let cookie = "";
          const headers = loginResponse.getAllHeaders();
          if (headers['Set-Cookie']) {
            const setCookie = Array.isArray(headers['Set-Cookie']) ? headers['Set-Cookie'] : [headers['Set-Cookie']];
            cookie = setCookie.map(c => c.split(';')[0]).join('; ');
          }

          if (!cookie) {
            return { name: "NTT Portal", status: "Login Error", color: "red", message: "ไม่สามารถขอ Session Cookie ได้ (Login Failed)", link: loginUrl };
          }

          // 2. Fetch Status Phase (GET with Cookie)
          const statusResponse = UrlFetchApp.fetch("https://portal.ntt.co.th/RealTimeStatus/curl_hostlist", {
            method: "get",
            headers: { "Cookie": cookie },
            muteHttpExceptions: true
          });

          const json = JSON.parse(statusResponse.getContentText());

          // 3. Parsing (จาก JSON ที่ได้จาก XHR /curl_hostlist)
          const hostUp = (json.count && json.count.up !== undefined) ? parseInt(json.count.up) : null;
          const serviceOk = (json.count_service && json.count_service.ok && json.count_service.ok.count !== undefined)
            ? parseInt(json.count_service.ok.count) : null;

          if (hostUp === null || serviceOk === null) {
            return { name: "NTT Portal", status: "Parse Error", color: "yellow", message: "เข้าสู่ระบบได้แต่ API ไม่ส่งข้อมูล Summary กลับมา", link: statusUrl };
          }

          let status = "Operational";
          let color = "green";
          let message = `Host UP: ${hostUp}/2, Service OK: ${serviceOk}/12`;

          // ตรวจสอบตามเงื่อนไข: Host ต้องเป็น 2 และ Service ต้องเป็น 12
          if (hostUp < 2 || serviceOk < 12) {
            status = (hostUp === 0) ? "Critical Outage" : "Degraded Performance";
            color = (hostUp === 0) ? "red" : "yellow";
            message = `พบความผิดปกติ! Host UP: ${hostUp} (เป้าหมาย 2), Service OK: ${serviceOk} (เป้าหมาย 12)`;
          }

          return {
            name: "NTT Portal",
            status: status,
            color: color,
            message: message,
            link: statusUrl
          };

        } catch (e) {
          return {
            name: "NTT Portal",
            status: "Fetch Error",
            color: "gray",
            message: "เกิดข้อผิดพลาดในการดึงข้อมูล: " + e.message,
            link: statusUrl
          };
        }
      }

      // 5. ฟังก์ชันเช็ค API Health / เช็คเว็บธรรมดา
      function fetchHtmlStatus(name, url) {
        try {
          const start = Date.now();
          const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
          const end = Date.now();
          const responseTime = (end - start) / 1000; // วินาที

          const code = response.getResponseCode();
          const now = new Date();
          const dateStr = Utilities.formatDate(now, "Asia/Bangkok", "HH:mm");

          if (code === 200) {
            if (responseTime > 3) {
              return {
                name: name,
                status: "Degraded",
                color: "yellow",
                message: `ตอบสนองช้า (${responseTime.toFixed(2)}s) - ตรวจสอบเมื่อ ${dateStr}`,
                link: url
              };
            }
            return {
              name: name,
              status: "Operational",
              color: "green",
              message: `ปกติ (${responseTime.toFixed(2)}s) - อัปเดตล่าสุด: ${dateStr}`,
              link: url
            };
          } else {
            // ถ้ารหัสไม่ใช่ 200 (เช่น 500, 502, 503, 504)
            return {
              name: name,
              status: "Outage",
              color: "red",
              message: `พบปัญหาการเชื่อมต่อ (HTTP Status: ${code})`,
              link: url
            };
          }
        } catch (e) {
          // ถ้าเว็บล่มจนเข้าไม่ได้เลย (Timeout / Connection Refused)
          return {
            name: name,
            status: "Outage",
            color: "red",
            message: "ไม่สามารถเชื่อมต่อได้ (Timeout/Connection Error)",
            link: url
          };
        }
      }

      // ------------------------------------------------
      // รวบรวมข้อมูลทั้งหมด (หาบรรทัดเหล่านี้แล้วเติม Unleash เข้าไปครับ)
      // ------------------------------------------------
      statuses.push(fetchRealStatus("Mux", "https://status.mux.com/api/v2/summary.json", "https://status.mux.com/"));
      statuses.push(fetchRealStatus("Akamai", "https://www.akamaistatus.com/api/v2/summary.json", "https://www.akamaistatus.com/"));
      statuses.push(fetchStatusGatorScrape("StatusGator", "https://statusgatorstatus.com/"));
      statuses.push(fetchAwsRss());
      statuses.push(fetchHtmlStatus("Tencent Cloud", "https://status.tencentcloud.com/"));

      // 🟢 เพิ่ม NTT Portal และ Unleash
      statuses.push(fetchNttStatus());
      statuses.push(fetchHtmlStatus("Unleash Health", "https://unleash.mthcdn.com/health"));

      // เซฟข้อมูลพร้อมประทับเวลาล่าสุดก่อนส่งกลับ (เพื่อทำ Persistent Cache)
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

      // 1. ดึง Timeline ของ Mux, Akamai
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

      // 2. ดึง Timeline ของ StatusGator (Scraping)
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

      // 3. แกะประวัติ Timeline ของ AWS จาก RSS Feed (กรองเฉพาะเอเชีย)
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

            // ✨ เช็คเฉพาะ title เท่านั้น ป้องกันการหลงไปเจอคำในรายละเอียด
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