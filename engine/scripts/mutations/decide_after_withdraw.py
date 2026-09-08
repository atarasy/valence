import pathlib
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = '    if (offer.state !== "presented") {\n      throw conflict("bad_state", `cannot decide an offer in ${offer.state}`);\n    }'
assert old in s, "anchor drifted"
s = s.replace(old, '    if (offer.state === "settled") {\n      throw conflict("bad_state", `cannot decide an offer in ${offer.state}`);\n    }', 1)
p.write_text(s)
