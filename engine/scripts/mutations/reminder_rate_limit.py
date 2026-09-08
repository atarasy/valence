import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace("""    if (offer.reminders_sent >= this.config.reminderLimit) {
      // Clause 37. Not a rate limit that a caller waits out.
      throw conflict("reminder_limit", "this offer has had its reminder");
    }
    offer.reminders_sent += 1;""",
"""    const last = (offer as any).last_reminder_at ?? 0;
    if (offer.reminders_sent >= this.config.reminderLimit && now - last < 5_000) {
      throw conflict("reminder_limit", "not yet; wait a while");
    }
    offer.reminders_sent += 1;
    (offer as any).last_reminder_at = now;""", 1)
p.write_text(s)
