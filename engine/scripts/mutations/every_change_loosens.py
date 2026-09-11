import pathlib
# Clause 46, second break beside tightening_needs_cosigner. Every change
# counts as a loosening, so lowering a ceiling, which is the person's alone,
# waits on whoever they named. A protection a person cannot tighten by
# themselves is not theirs.
p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
old = 'export function loosens(before: Mandate, after: Mandate): boolean {'
assert old in s, "every_change_loosens: the anchor has drifted"
s = s.replace(old, 'export function loosens(before: Mandate, after: Mandate): boolean {\n  if (before || after) return true;', 1)
p.write_text(s)
