import pathlib

# §6.5, clause 8. The unsigned-statement block counts every presenter's boxes,
# so one presenter's unsettled statement stops another presenter's delivery
# and the refusal is computed from a cross-presenter union. Clause 8 gives the
# union to the person and to nobody else, and §16.3 records the same objection
# against an engine computing a household's daily total. On a split deployment
# the wide version also reaches nothing, since each engine holds its own
# offers, so it promises a pressure it cannot apply.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "      if (other.presenter !== presenter) continue;"
assert a in s, "offers.ts block presenter anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)
