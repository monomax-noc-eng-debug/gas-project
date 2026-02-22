/**
 * src/backend/controllers/SettingController.js
 */
const SettingController = (() => {

  const ensureSheet = (ss, name, headers, defaults = []) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      if (defaults.length > 0) {
        const rows = defaults.map(d => headers.map(h => d[h] || ""));
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }

      // Basic formatting for the new sheet
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f4f6");
      sheet.setFrozenRows(1);
    }
    return sheet;
  };

  const parseData = (sheet) => {
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    const headers = data[0].map(h => String(h).trim());
    return data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
  };

  const saveData = (ss, sheetName, headers, objects) => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f4f6");
      sheet.setFrozenRows(1);
    }
    sheet.clearContents();
    const data = [headers];
    objects.forEach(obj => {
      data.push(headers.map(h => obj[h] !== undefined ? obj[h] : ""));
    });
    if (data.length > 0 && headers.length > 0) {
      sheet.getRange(1, 1, data.length, headers.length).setValues(data);
    }
  };

  return {
    resetSettingSheets: function () {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(30000)) {
          const dbId = typeof CONFIG !== "undefined" ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty("CORE_SHEET_ID");
          const ss = SpreadsheetApp.openById(dbId);

          const oldSheets = [
            "Setting_Ticket", "Setting_Staff", "Setting_EmailProfile",
            "Setting_EmailDraft", "Setting_MailDraft", "Setting_Handover_Tags"
          ];

          oldSheets.forEach(name => {
            const sh = ss.getSheetByName(name);
            if (sh) ss.deleteSheet(sh);
          });

          // Re-create to ensure freshness
          ["SYS_Users", "SYS_Ticket_Attrs", "SYS_Ticket_Categories", "SYS_Email_Profiles", "SYS_Email_Templates", "SYS_Handover_Tags"].forEach(name => {
            const sh = ss.getSheetByName(name);
            if (sh) ss.deleteSheet(sh);
          });

          ensureSheet(ss, "SYS_Users", ["Role", "Name"], [
            { Role: "Responsibility", Name: "Admin" },
            { Role: "Operator", Name: "Staff1" }
          ]);

          ensureSheet(ss, "SYS_Ticket_Attrs", ["Group", "Name"], [
            { Group: "Type", Name: "Incident" },
            { Group: "Type", Name: "Request" },
            { Group: "Status", Name: "Open" },
            { Group: "Status", Name: "Pending" },
            { Group: "Status", Name: "Resolved" },
            { Group: "Status", Name: "Closed" },
            { Group: "Severity", Name: "Normal" },
            { Group: "Severity", Name: "High" },
            { Group: "Severity", Name: "Critical" }
          ]);

          ensureSheet(ss, "SYS_Ticket_Categories", ["Category", "SubCategory"], [
            { Category: "Hardware", SubCategory: "Monitor" },
            { Category: "Software", SubCategory: "Windows" },
            { Category: "Network", SubCategory: "Internet" }
          ]);

          ensureSheet(ss, "SYS_Email_Profiles", ["ProfileName", "To", "CC"]);

          ensureSheet(ss, "SYS_Email_Templates", ["Type", "TemplateName", "Greeting", "Company", "ContactName", "ContactNum", "SiteEmail", "SiteAddr", "Action"]);

          ensureSheet(ss, "SYS_Handover_Tags", ["TagName"], [
            { TagName: "Ticket" },
            { TagName: "REQ" },
            { TagName: "Customer" },
            { TagName: "Routine" }
          ]);

          return Response.success({ message: "ล้างและตั้งค่าชีทใหม่ทั้งหมดเรียบร้อย" });
        }
      } catch (e) {
        return Response.error("Reset Failed: " + String(e));
      } finally {
        lock.releaseLock();
      }
    },

    apiGetAllSettings: function () {
      try {
        const dbId = typeof CONFIG !== "undefined" ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty("CORE_SHEET_ID");
        const ss = SpreadsheetApp.openById(dbId);

        // Ensure sheets exist if never created
        if (!ss.getSheetByName("SYS_Users")) this.resetSettingSheets();

        const usersData = parseData(ss.getSheetByName("SYS_Users"));
        const attrsData = parseData(ss.getSheetByName("SYS_Ticket_Attrs"));
        const catsData = parseData(ss.getSheetByName("SYS_Ticket_Categories"));
        const profsData = parseData(ss.getSheetByName("SYS_Email_Profiles"));
        const tmplsData = parseData(ss.getSheetByName("SYS_Email_Templates"));
        const tagsData = parseData(ss.getSheetByName("SYS_Handover_Tags"));

        const config = {
          staff: [], assignees: [], types: [], statuses: [], severities: [],
          categories: {}, handoverTags: [], emailProfiles: [], emailDrafts: [], mailDrafts: []
        };

        const addUnique = (arr, val) => {
          if (val && String(val).trim() !== "" && !arr.includes(val)) arr.push(String(val).trim());
        };

        usersData.forEach(u => {
          const role = String(u.Role || "").toLowerCase();
          const name = String(u.Name || "").trim();
          if (!name) return;
          if (role.includes("responsibility") || role.includes("leader")) addUnique(config.staff, name);
          if (role.includes("operator") || role.includes("assignee")) addUnique(config.assignees, name);
        });

        attrsData.forEach(a => {
          const grp = String(a.Group || "").trim();
          const name = String(a.Name || "").trim();
          if (!name) return;
          if (grp === "Type") addUnique(config.types, name);
          if (grp === "Status") addUnique(config.statuses, name);
          if (grp === "Severity") addUnique(config.severities, name);
        });

        catsData.forEach(c => {
          const cat = String(c.Category || "").trim();
          const sub = String(c.SubCategory || "").trim();
          if (cat) {
            if (!config.categories[cat]) config.categories[cat] = [];
            if (sub && !config.categories[cat].includes(sub)) config.categories[cat].push(sub);
          }
        });

        tagsData.forEach(t => {
          addUnique(config.handoverTags, t.TagName);
        });

        profsData.forEach(p => {
          if (p.ProfileName) {
            config.emailProfiles.push({
              name: String(p.ProfileName).trim(),
              to: String(p.To || "").trim(),
              cc: String(p.CC || "").trim()
            });
          }
        });

        tmplsData.forEach(t => {
          const tmpl = {
            name: String(t.TemplateName || "").trim(),
            greeting: String(t.Greeting || ""),
            company: String(t.Company || ""),
            contactName: String(t.ContactName || ""),
            contactNum: String(t.ContactNum || ""),
            siteEmail: String(t.SiteEmail || ""),
            siteAddr: String(t.SiteAddr || ""),
            action: String(t.Action || "")
          };
          if (!tmpl.name) return;
          if (String(t.Type) === "Mail") config.mailDrafts.push(tmpl);
          else config.emailDrafts.push(tmpl);
        });

        // Deduplicate simple arrays
        config.staff = [...new Set(config.staff)];
        config.assignees = [...new Set(config.assignees)];
        config.types = [...new Set(config.types)];
        config.statuses = [...new Set(config.statuses)];
        config.severities = [...new Set(config.severities)];
        config.handoverTags = [...new Set(config.handoverTags)];

        return Response.success(config);

      } catch (e) {
        return Response.error("Get Settings Failed: " + String(e));
      }
    },

    apiSaveAllSettings: function (payload) {
      const lock = LockService.getScriptLock();
      try {
        if (lock.tryLock(30000)) {
          const dbId = typeof CONFIG !== "undefined" ? CONFIG.DB_ID : PropertiesService.getScriptProperties().getProperty("CORE_SHEET_ID");
          const ss = SpreadsheetApp.openById(dbId);
          const config = payload || {};

          const usersRow = [];
          (config.staff || []).forEach(name => usersRow.push({ Role: "Responsibility", Name: name }));
          (config.assignees || []).forEach(name => usersRow.push({ Role: "Operator", Name: name }));
          saveData(ss, "SYS_Users", ["Role", "Name"], usersRow);

          const attrsRow = [];
          (config.types || []).forEach(name => attrsRow.push({ Group: "Type", Name: name }));
          (config.statuses || []).forEach(name => attrsRow.push({ Group: "Status", Name: name }));
          (config.severities || []).forEach(name => attrsRow.push({ Group: "Severity", Name: name }));
          saveData(ss, "SYS_Ticket_Attrs", ["Group", "Name"], attrsRow);

          const catsRow = [];
          if (config.categories) {
            for (const cat in config.categories) {
              const subs = config.categories[cat];
              if (!subs || subs.length === 0) catsRow.push({ Category: cat, SubCategory: "" });
              else subs.forEach(sub => catsRow.push({ Category: cat, SubCategory: sub }));
            }
          }
          saveData(ss, "SYS_Ticket_Categories", ["Category", "SubCategory"], catsRow);

          const profsRow = (config.emailProfiles || []).map(p => ({
            ProfileName: p.name, To: p.to, CC: p.cc
          }));
          saveData(ss, "SYS_Email_Profiles", ["ProfileName", "To", "CC"], profsRow);

          const tmplsRow = [];
          (config.emailDrafts || []).forEach(t => tmplsRow.push({ Type: "Email", TemplateName: t.name, Greeting: t.greeting, Company: t.company, ContactName: t.contactName, ContactNum: t.contactNum, SiteEmail: t.siteEmail, SiteAddr: t.siteAddr, Action: t.action }));
          (config.mailDrafts || []).forEach(t => tmplsRow.push({ Type: "Mail", TemplateName: t.name, Greeting: t.greeting, Company: t.company, ContactName: t.contactName, ContactNum: t.contactNum, SiteEmail: t.siteEmail, SiteAddr: t.siteAddr, Action: t.action }));
          saveData(ss, "SYS_Email_Templates", ["Type", "TemplateName", "Greeting", "Company", "ContactName", "ContactNum", "SiteEmail", "SiteAddr", "Action"], tmplsRow);

          const tagsRow = (config.handoverTags || []).map(t => ({ TagName: t }));
          saveData(ss, "SYS_Handover_Tags", ["TagName"], tagsRow);

          return Response.success({ message: "บันทึกตั้งค่าทั้งหมดสำเร็จ" });
        }
      } catch (e) {
        return Response.error("Save Failed: " + String(e));
      } finally {
        lock.releaseLock();
      }
    }
  };
})();
