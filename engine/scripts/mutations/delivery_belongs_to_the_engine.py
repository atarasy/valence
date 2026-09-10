import pathlib

# §7.5b, §13.1. Put the household's delivery surface on the engine's side,
# where its path would put it. A merchant would then read a carrier's code,
# which resolves to an address, and the wall clause 49 keeps would be gone by
# a routing decision rather than by a field.
#
# Renamed from decisions_belong_to_the_engine on 2026-09-11, when deciding
# moved back to the engine: authority travels in the signature, and a hub that
# answered for deciding had no offer to decide on.

p = pathlib.Path("src/common/roles.ts"); s = p.read_text()
a = 'const HUB_OFFER_ACTIONS = new Set(["delivery"]);'
assert a in s, "roles.ts hub-action anchor has drifted"
s = s.replace(a, "const HUB_OFFER_ACTIONS = new Set<string>([]);", 1)
p.write_text(s)
