import pathlib
# §14.2, question 56. Keep a claim at a version no household reaches. Signing
# it leaves no room to follow, so every later change, tightenings included, is
# refused as stale and the mandate is frozen.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    if (!Number.isSafeInteger(m.version) || m.version < 1 || m.version > MAX_CLAIMED_VERSION) return;\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
