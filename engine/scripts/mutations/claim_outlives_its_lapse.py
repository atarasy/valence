import pathlib
# §14.2, question 56. Offer a claim that has lapsed, which `record` refuses as
# lapsed, and let it keep the identifier: a household that did not sign in time
# could then never sign and no route removed the row.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    return claim && claim.lapses_at > now ? claim : undefined;\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    return claim;\n', 1))
