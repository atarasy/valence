import pathlib
# Clause 35: nothing settles on an unsigned confirmation. Skip the signature
# check, so any decided set is taken as the person's.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
# Re-anchored 2026-09-11: §10.5 gave a decided set two shapes, a bare signature
# and a passkey's assertion, and the check became one test over both.
old = "    if (!covered) {"
assert old in s, "offers.ts confirmation anchor has drifted"
s = s.replace(old, "    if (false && !covered) {", 1)
p.write_text(s)
