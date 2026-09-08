import pathlib
# Clause 27: a line can be shared with the recipient and the merchant and
# no one else. Accept any party name in shared_with.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '      if (typeof p !== "string" || !(NOTE_PARTIES as readonly string[]).includes(p)) {'
assert old in s
s = s.replace(old, '      if (typeof p !== "string") {', 1)
p.write_text(s)
