import pathlib

# §7.6b, §10. The published list of reasons an agent may exclude a candidate
# gains one about what a household wrote. A routing rule named for a note puts
# the 告示's inference into the protocol: an agent may then drop a household
# that said nothing, and the reason is one a person can read and cannot refuse.

p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
a = '  "declined_before",\n] as const;'
assert a in s, "approval.ts exclusion list anchor has drifted"
s = s.replace(a, '  "declined_before",\n  "no_note",\n] as const;', 1)
p.write_text(s)
