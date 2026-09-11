import pathlib
# Section 14.2, second break beside import_accepts_anything. Ask that the
# document name a format and not that the name be one this host knows, so an
# export written for another implementation is read field by field and
# whatever this host cannot parse is dropped in silence. The other mutation
# removes the check; this one keeps a check that answers the wrong question.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '      if (!body_ || body_.format !== EXPORT_FORMAT_VERSION) {'
assert old in s, "import_reads_a_format_it_does_not_know: the anchor has drifted"
s = s.replace(old, '      if (!body_ || typeof body_.format !== "string" || !body_.format) {', 1)
p.write_text(s)
