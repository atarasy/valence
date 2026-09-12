import pathlib

# Clause 10, §6.2. The approval surface shows no giver, so a gift and a
# purchase look the same on the screen a person signs from: a unit price
# beside each, and nothing to say which lines will be charged. The offer view
# names the giver and the settlement bills the gift at zero, so every other
# surface is right and the one a person reads is wrong.

p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
a = "        given_by: c.given_by,"
assert a in s, "approval.ts given_by anchor has drifted"
s = s.replace(a, "        given_by: null,", 1)
p.write_text(s)
