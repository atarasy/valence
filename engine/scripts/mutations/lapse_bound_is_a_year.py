import pathlib
# §16.1, clause 58, decided 2026-09-20 after the second refutation pass over
# question 68. Put the bound back at 366 days, which is a year plus the
# minutes between two clocks. The reference hub computes the lapse on the
# member's device, so a phone two days fast is then refused every change to
# its own protections, tightenings included.
p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
old = "export const MAX_LAPSE_MS = 400 * 86_400_000;"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "export const MAX_LAPSE_MS = 366 * 86_400_000;", 1)
p.write_text(s)
