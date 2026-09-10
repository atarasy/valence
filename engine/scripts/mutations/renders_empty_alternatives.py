import pathlib

# Clause 59: a proposal carries alternatives and the argument against.
#
# The guard that refuses to render a deliberation which is missing or empty
# stays intact, so the two probes that check the refusal keep passing. What
# changes is the serialisation: the screen renders 200 and the alternatives
# arrive empty. That is the shape the probe on the rendered screen exists for,
# and until 2026-09-09 nothing produced it: every mutation of this surface
# broke the guard instead, so the refusal probes caught them and the probe on
# the rendered screen had never been shown to fail.

p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
anchor = "        alternatives: entry.alternatives,\n        argument_against: entry.argument_against,"
assert anchor in s, "approval.ts serialisation anchor has drifted"
s = s.replace(anchor, "        alternatives: [],\n        argument_against: entry.argument_against,", 1)
p.write_text(s)
