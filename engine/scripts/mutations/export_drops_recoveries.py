import pathlib
# Clause 53, second break beside recovery_not_logged. The log is written and
# left behind on the move, so a member who changes hosts arrives with no
# record of who recovered their access.
p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
old = '    recoveries: recovery.logFor(household),'
assert old in s, "export_drops_recoveries: the anchor has drifted"
s = s.replace(old, '    recoveries: [],', 1)
p.write_text(s)
