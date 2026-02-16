const TicketService = {
  /**
   * getTicketDetails — 3 Buckets Standard
   * 
   * 🟢 Bucket 1: งานเข้าใหม่ (New) — Created Date == targetDate
   *    ไม่สนว่าสถานะปัจจุบันจะเป็นอะไร (แม้ปิดเลยก็นับเป็น New)
   * 
   * 🔵 Bucket 2: งานที่ทำเสร็จ (Resolved/Closed) — Resolved Date == targetDate
   *    ไม่ต้องสนว่าสร้างเมื่อไหร่ สร้างเมื่อวานแต่ซ่อมเสร็จวันนี้ก็นับ
   *    (ยึด Closed เป็นหลัก แต่รวม Resolved ด้วย)
   * 
   * 🔴 Bucket 3: งานค้าง (Backlog) — Status ไม่ใช่ Done/Closed/Resolved
   *    นับรวมทุกวันที่ (ของเก่าที่ยังไม่ปิดก็ต้องแสดง)
   */
  getTicketDetails: function (dateString) {
    try {
      const res = TicketController.getTickets(false);
      const resObj = JSON.parse(res);
      if (!resObj.success) return res;

      const tickets = resObj.data || [];
      const targetDate = String(dateString).trim();

      // 3-Bucket Stats
      let stats = { total: 0, new: 0, resolved: 0, closed: 0, backlog: 0 };

      // Lists for display
      let listNew = [];       // งานเข้าใหม่วันนี้
      let listResolved = [];  // งานที่ปิดได้วันนี้ (รวมทั้งสร้างวันนี้และเมื่อวาน)
      let listBacklog = [];   // งานค้าง (ทุกวัน)

      tickets.forEach(t => {
        if (!t || !t.ticketNumber) return;
        const id = t.ticketNumber;
        const statusRaw = String(t.status || "").toUpperCase().trim();
        const statusDisplay = t.status || "";
        // Prioritize Subject (Short Description) as requested
        const detail = t.subject || t.detail || '-';

        // Parse dates
        const createdParsed = API_UTILS.parseCustomDateTime(t.createdDate);
        const resolvedParsed = API_UTILS.parseCustomDateTime(t.resolvedDate);

        // Fallback for created date (if incident date created is used)
        const incidentParsed = API_UTILS.parseCustomDateTime(t.date);
        const createdDateStr = createdParsed.date || incidentParsed.date;
        const resolvedDateStr = resolvedParsed.date;

        const isCreatedToday = (createdDateStr === targetDate);
        const isResolvedToday = (resolvedDateStr === targetDate);

        // Is this ticket "done"? (Resolved / Closed / Done)
        const isDone = statusRaw.includes("RESOLVED") || statusRaw.includes("CLOSE") || statusRaw.includes("DONE") || statusRaw.includes("FIX");

        // 🟢 Bucket 1: New — สร้างวันนี้ (ไม่สนสถานะ)
        if (isCreatedToday) {
          stats.new++;
          listNew.push({ id, status: statusDisplay, detail, tag: 'NEW' });
        }

        // 🔵 Bucket 2: Resolved/Closed today — ปิดได้วันนี้ (ไม่สนวันที่สร้าง)
        // Case: สร้างเมื่อวาน ปิดวันนี้ -> isCreatedToday=false, isResolvedToday=true -> เข้าเงื่อนไขนี้
        if (isResolvedToday && isDone) {
          if (statusRaw.includes("CLOSE")) {
            stats.closed++;
          } else {
            stats.resolved++;
          }

          // Add to listResolved (to show "งานที่ปิดได้วันนี้")
          // Note: If created today & closed today, it's already in listNew. 
          // We can choose to show it in both or just one. usually show in New is enough.
          // BUT user said "List ต้องแสดงเพื่อบอกว่างานค้างจากเมื่อวานปิดแล้ว" -> implying NOT created today.
          if (!isCreatedToday) {
            listResolved.push({ id, status: statusDisplay, detail, tag: 'RESOLVED' });
          }
        }

        // 🔴 Bucket 3: Backlog — ยังไม่ Done (ไม่สนวันที่สร้าง, นับทุกอัน)
        if (!isDone) {
          stats.backlog++;
          // Avoid duplicate if already in listNew (though usually backlog is open/pending)
          if (!isCreatedToday) {
            listBacklog.push({ id, status: statusDisplay, detail, tag: 'BACKLOG' });
          }
        }
      });

      // Combine all lists (New first, then Resolved today (finished work), then Backlog)
      const combinedList = [...listNew, ...listResolved, ...listBacklog];
      stats.total = combinedList.length;

      // For backward compat: map backlog → open + pending
      stats.open = stats.backlog;
      stats.pending = 0;

      // Build summary text
      const summaryText =
        `━━ สรุป Ticket (${targetDate}) ━━\n` +
        `🟢 งานเข้าใหม่: ${stats.new}\n` +
        `🔵 ปิดได้วันนี้: ${stats.resolved + stats.closed} (Resolved: ${stats.resolved}, Closed: ${stats.closed})\n` +
        `🔴 งานค้าง: ${stats.backlog}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        combinedList.map(t => {
          let icon = '⚪';
          if (t.tag === 'NEW') icon = '🟢';
          else if (t.tag === 'RESOLVED') icon = '🔵'; // Finished work
          else if (t.tag === 'BACKLOG') icon = '🔴';
          return `${icon} ${t.id} (${t.status}) — ${t.detail}`;
        }).join("\n");

      return JSON.stringify({ success: true, list: combinedList, stats, text: summaryText });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  }
};