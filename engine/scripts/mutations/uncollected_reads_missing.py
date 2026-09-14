import pathlib

# §3, question 48. A line no collection named reads as missing, so a line the
# deadline made lost is shown as a collection's record about the household's
# home, on no statement the household could dispute it on.

p = pathlib.Path("src/shared/collected.ts"); s = p.read_text()
a = '  if (!recovery || recovery.collected_at == null) return null;'
assert a in s, "src/shared/collected.ts uncollected_reads_missing anchor has drifted"
s = s.replace(a, '  if (!recovery || recovery.collected_at == null) return "missing";', 1)
p.write_text(s)
