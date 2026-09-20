import pathlib
# §10.5: nothing is written on refusal. Put the record of a decided set's
# protections back before the day is told, which is the last thing in `decide`
# that can fail. A day source that throws then leaves `decided_protections` on
# the disk of a set the disk still holds as `presented`. Measured by the
# second refutation pass over question 68.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = '    if (offer.state === "decided") this.decidedProtections.set(offer.id, fixed!);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
old = '      offer.decided_at = now;\n      // Clause 8. The person\'s own copy'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      offer.decided_at = now;\n      this.decidedProtections.set(offer.id, fixed!);\n      // Clause 8. The person\'s own copy', 1)
p.write_text(s)
