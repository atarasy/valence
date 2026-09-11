import pathlib
# Section 16.1, second break beside mandate_any_version. Refuse only versions
# from the future, so an old version and its old signature can be replayed
# onto a record that has moved past them.
p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
old = '    if (before && mandate.version !== before.version + 1) {'
assert old in s, "version_may_go_backwards: the anchor has drifted"
s = s.replace(old, '    if (before && mandate.version > before.version + 1) {', 1)
p.write_text(s)
