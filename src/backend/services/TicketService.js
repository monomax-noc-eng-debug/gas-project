const TicketService = {
  getTicketDetails: function (dateString) {
    try {
      const res = TicketController.getTickets(false);
      const resObj = JSON.parse(res);
      if (!resObj.success) return res;

      const tickets = resObj.data || [];
      const targetDate = String(dateString).trim();

      let stats = { total: 0, new: 0, resolved: 0, closed: 0, backlog: 0 };
      let listNew = [];
      let listResolved = [];
      let listBacklog = [];

      // ✨ กำหนดกลุ่มคำที่ถือว่า "ปิดงาน/เสร็จสิ้น" ให้ชัดเจน
      const DONE_STATUSES = [
        "RESOLVED",
        "CLOSED",
        "CLOSE",
        "DONE",
        "FIX",
        "FIXED",
      ];

      tickets.forEach((t) => {
        if (!t || !t.ticketNumber) return;
        const id = t.ticketNumber;
        const statusRaw = String(t.status || "")
          .toUpperCase()
          .trim();
        const statusDisplay = t.status || "";
        const detail = t.subject || t.detail || "-";

        const createdParsed = API_UTILS.parseCustomDateTime(t.createdDate);
        const resolvedParsed = API_UTILS.parseCustomDateTime(t.resolvedDate);
        const incidentParsed = API_UTILS.parseCustomDateTime(t.date);

        const createdDateStr = createdParsed.date || incidentParsed.date;
        const resolvedDateStr = resolvedParsed.date;

        const isCreatedToday = createdDateStr === targetDate;
        const isResolvedToday = resolvedDateStr === targetDate;

        // ✨ เช็คความถูกต้องแบบ Exact / Includes ที่ปลอดภัยขึ้น
        const isDone = DONE_STATUSES.some(
          (s) => statusRaw === s || statusRaw.includes(s),
        );

        if (isCreatedToday) {
          stats.new++;
          listNew.push({ id, status: statusDisplay, detail, tag: "NEW" });
        }

        if (isResolvedToday && isDone) {
          if (statusRaw.includes("CLOSE")) {
            stats.closed++;
          } else {
            stats.resolved++;
          }
          if (!isCreatedToday) {
            listResolved.push({
              id,
              status: statusDisplay,
              detail,
              tag: "RESOLVED",
            });
          }
        }

        if (!isDone) {
          stats.backlog++;
          if (!isCreatedToday) {
            listBacklog.push({
              id,
              status: statusDisplay,
              detail,
              tag: "BACKLOG",
            });
          }
        }
      });

      const combinedList = [...listNew, ...listResolved, ...listBacklog];
      stats.total = combinedList.length;
      stats.open = stats.backlog;
      stats.pending = 0;

      const summaryText =
        `━━ สรุป Ticket (${targetDate}) ━━\n` +
        `🟢 งานเข้าใหม่: ${stats.new}\n` +
        `🔵 ปิดได้วันนี้: ${stats.resolved + stats.closed} (Resolved: ${stats.resolved}, Closed: ${stats.closed})\n` +
        `🔴 งานค้าง: ${stats.backlog}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        combinedList
          .map((t) => {
            let icon = "⚪";
            if (t.tag === "NEW") icon = "🟢";
            else if (t.tag === "RESOLVED") icon = "🔵";
            else if (t.tag === "BACKLOG") icon = "🔴";
            return `${icon} ${t.id} (${t.status}) — ${t.detail}`;
          })
          .join("\n");

      return JSON.stringify({
        success: true,
        list: combinedList,
        stats,
        text: summaryText,
      });
    } catch (e) {
      return JSON.stringify({ success: false, error: e.toString() });
    }
  },
};
