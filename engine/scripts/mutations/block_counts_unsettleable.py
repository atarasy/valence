import pathlib
# §6.5. The block counts a box the household cannot settle: one still
# `presented` after a partial collection, where settle is a 409, and one a
# presenter withdrew, which can never be settled at all. Either makes the
# household unofferable and leaves it no way to cure.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = '      if (other.state !== "decided" && other.state !== "expired") continue;'
assert a in s, "offers.ts block state anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)
