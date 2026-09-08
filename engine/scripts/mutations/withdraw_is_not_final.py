import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
# Withdrawing leaves the candidates open, and a withdrawn offer can still be
# decided. Either alone is caught by another rule; together they are the state
# a presenter would need to reopen an offer it had revoked.
a = """    for (const c of offer.candidates) {
      if (c.valence === "offered") {
        c.valence = "returned";
        c.decided_at = now;
      }
    }
    offer.state = "withdrawn";"""
assert a in s, "anchor drifted (withdraw body)"
s = s.replace(a, '    offer.state = "withdrawn";', 1)
b = '    if (offer.state !== "presented") {\n      throw conflict("bad_state", `cannot decide an offer in ${offer.state}`);\n    }'
assert b in s, "anchor drifted (decide guard)"
s = s.replace(b, '    if (offer.state === "settled") {\n      throw conflict("bad_state", `cannot decide an offer in ${offer.state}`);\n    }', 1)
p.write_text(s)
