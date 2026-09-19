import pathlib
# §10.5, decided 2026-09-19 with the lapse rules. `decide` now waits on the
# mandate source before writing; drop the check made after the wait, so two
# decisions of one set in flight are both applied.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (\n      !current || current.state !== "presented" ||'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false && (\n      !current || current.state !== "presented" ||', 1)
old = '      (this.confirmations.get(offerId) ?? []).includes(confirmation)\n    ) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      (this.confirmations.get(offerId) ?? []).includes(confirmation))\n    ) {', 1)
p.write_text(s)
