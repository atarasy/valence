import pathlib
# §14.2, question 56. Keep a claim that has already lapsed, which `record`
# refuses as lapsed for ever, so the identifier holds a row nobody can act on.
# The import route's own shape check admits `lapses_at: 0`.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    if (m.lapses_at <= now) return;\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
# The later claim lookup also hides expired rows. Break both admission and
# lookup for this mutation to expose the lapsed claim the unit probe observes.
s = p.read_text()
old = '    return claim && claim.lapses_at > now ? claim : undefined;'
assert s.count(old) == 1, "claim lookup anchor drifted"
p.write_text(s.replace(old, '    return claim;', 1))
