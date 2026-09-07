import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace("    if (offer.reminders_sent >= this.config.reminderLimit) {",
              "    if (offer.reminders_sent >= 5) {", 1)
p.write_text(s)
