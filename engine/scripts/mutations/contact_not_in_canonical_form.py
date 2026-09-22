import pathlib
# Question 72. The contact stops reaching the bytes a merchant signs: the
# line is never appended, so a merchant's signature no longer covers which
# contact is shown beside its block, and a tampered contact still verifies.
p = pathlib.Path("src/shared/disclosure.ts"); s = p.read_text()
old = """  if (d.contact) {
    parts.push(`contact:${d.contact.kind}=${encodeURIComponent(d.contact.value)}`);
  }
  return Buffer.from(parts.join("\\n"), "utf8");"""
assert old in s, "contact_not_in_canonical_form: the anchor has drifted"
s = s.replace(old, """  return Buffer.from(parts.join("\\n"), "utf8");""", 1)
p.write_text(s)
