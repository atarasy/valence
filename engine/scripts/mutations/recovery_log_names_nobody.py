import pathlib
# Clause 53, second break beside recovery_not_logged. Keep the log and empty
# the name in it, so a recovery is recorded and nobody can be asked about it.
# A log that does not say who acted answers no question the clause asks.
p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
old = '      initiated_by: input.by,'
assert old in s, "recovery_log_names_nobody: the anchor has drifted"
s = s.replace(old, '      initiated_by: "",', 1)
p.write_text(s)
