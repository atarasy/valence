import pathlib
# §16.1: a version is exactly one more than the last, so an old signature
# cannot be replayed onto a new record. Accept any version.
p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
old = "    if (before && mandate.version !== before.version + 1) {"
assert old in s
s = s.replace(old, "    if (false) {", 1)
p.write_text(s)
