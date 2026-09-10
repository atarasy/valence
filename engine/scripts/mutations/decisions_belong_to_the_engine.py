import pathlib

# §13.1. Put the two actions that carry the person's authority on the engine's
# side, which is where their path would put them: a hub alone would then not
# answer for a person's own signature or their own delivery.

p = pathlib.Path("src/common/roles.ts"); s = p.read_text()
a = 'const HUB_OFFER_ACTIONS = new Set(["decisions", "delivery"]);'
assert a in s, "roles.ts hub-action anchor has drifted"
s = s.replace(a, "const HUB_OFFER_ACTIONS = new Set<string>([]);", 1)
p.write_text(s)
