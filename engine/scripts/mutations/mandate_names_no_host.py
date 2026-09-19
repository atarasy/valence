import pathlib
# §16.1, question 58. Sign a mandate version over bytes that name no host, so
# a version signed for one host records at any other.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '      MANDATE_DOMAIN,\n      host,\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      MANDATE_DOMAIN,\n', 1)
p.write_text(s)
