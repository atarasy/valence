import pathlib
# Section 10.5, second break beside decide_writes_on_refusal, reaching the
# same probe from the other end: the line that makes a set bad stops being
# bad. A kept candidate with no kept_as is accepted, so the set the probe
# sends is written rather than refused and there is nothing to leave as it
# was. What the probe asserts is that a refusal changes nothing; this removes
# the refusal.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = '        if (!d.kept_as) {\n          throw badRequest("malformed", "kept requires kept_as");\n        }'
assert old in s, "kept_needs_nothing_else: the anchor has drifted"
s = s.replace(old, '        if (!d.kept_as) {\n          d.kept_as = "self";\n        }', 1)
p.write_text(s)
