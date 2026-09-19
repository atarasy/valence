import pathlib
# §12, question 58. Sign a gift over bytes that name no host.
p = pathlib.Path('src/shared/gift.ts'); s = p.read_text()
old = '[GIFT_DOMAIN, name(t.host), t.offer,'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '[GIFT_DOMAIN, t.offer,', 1)
p.write_text(s)
