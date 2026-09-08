import pathlib
p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
old = "      reminded: offer.reminders_sent > 0,"
assert old in s, "anchor drifted"
s = s.replace(old, "      reminded: false,\n      reminders_left: 1 - offer.reminders_sent,", 1)
s = s.replace("export type Approval = {", "export type Approval = {\n  reminders_left?: number;", 1)
p.write_text(s)
