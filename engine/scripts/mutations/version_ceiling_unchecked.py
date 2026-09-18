import pathlib
# §16.1. Take a version with no room to follow it. At 2^53 the next version is
# the same number, so the version stops rising and an old signature replays
# onto a new record, which is the one thing the version in the bytes prevents.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    if (!Number.isSafeInteger(mandate.version) || mandate.version < 1 || mandate.version >= Number.MAX_SAFE_INTEGER) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    if (false) {\n', 1))
