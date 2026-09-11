import pathlib
# Clause 43, second break beside export_only_what_surfaces_show, and in the
# engine rather than in the export, so the two do not drift together. Return
# only the edges pointing at this household, which is what the giver's surface
# shows. A member who moves hosts then loses their record of what they gave.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = '      (e) => e.from === household || e.to === household'
assert old in s, "lineage_export_drops_the_giver: the anchor has drifted"
s = s.replace(old, '      (e) => e.to === household', 1)
p.write_text(s)
