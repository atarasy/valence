import pathlib

# Clause 53: recovery is logged and the log leaves with the node. The export
# carried it and the receiving host dropped it, silently, until 2026-09-09.

p = pathlib.Path("src/http.ts"); s = p.read_text()
a = "      recovery.importLog(moving, body_.recoveries ?? []);"
assert a in s, "http.ts import anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)
