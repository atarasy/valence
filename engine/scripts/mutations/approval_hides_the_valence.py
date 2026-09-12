import pathlib

# §10 step 3c. The approval renders every candidate identically, with nothing
# to say which lines a collection or an earlier decision has already resolved.
# **This is what the surface did until 2026-09-12.** A physical box is
# collected line by line and the offer stays `presented`, so a hub that asks
# for a choice on every candidate posts a set naming a consumed one, the
# engine refuses it with `already_decided`, and the household can never
# confirm the lines that are still its own from that screen.

p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
a = "        is_exploration: c.is_exploration,\n        valence: c.valence,\n"
assert a in s, "approval.ts valence anchor has drifted"
s = s.replace(a, "        is_exploration: c.is_exploration,\n", 1)
p.write_text(s)
