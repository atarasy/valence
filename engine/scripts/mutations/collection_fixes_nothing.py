import pathlib
# §16.3, §11.2, decided 2026-09-19. A collection that decides a box records
# nothing, so the box settles days later against the live ceiling alone.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (fixed && after.state === "decided" && after.decided_at === at) this.decidedProtections.set(after.id, fixed);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
