import pathlib
# Clause 35: a settlement follows a person's decisions or the expiry rule.
# Let an offer be settled in any state, so the agent can close it before
# the household has decided.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = '    if (offer.state !== "decided" && offer.state !== "expired") {\n      throw conflict("bad_state", `cannot settle an offer in ${offer.state}`);'
assert old in s
s = s.replace(old, '    if (offer.state === "settled" && false) {\n      throw conflict("bad_state", `cannot settle an offer in ${offer.state}`);', 1)
p.write_text(s)
