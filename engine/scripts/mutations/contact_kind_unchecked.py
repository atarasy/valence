import pathlib
# Question 72. `kind` stops being checked against the three allowed values:
# any string is taken as given. A kind the per-kind branches below do not
# recognise falls to the `url` branch, so a caller naming an unknown kind
# beside a well-formed https value is registered rather than refused.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '  const kind = requireEnum(c, "kind", "disclosure contact", DISCLOSURE_CONTACT_KINDS);'
assert old in s, "contact_kind_unchecked: the anchor has drifted"
s = s.replace(old, '  const kind = requireString(c, "kind", "disclosure contact") as "email" | "tel" | "url";', 1)
p.write_text(s)
