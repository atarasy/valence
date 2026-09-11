import pathlib
# Clause 12 ends "every lineage edge names who made it". Drop the maker from
# the stored edge, so the gift travels with the seller's name and without the
# name of whoever made the thing.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """      merchant: input.merchant,
      maker: input.maker,
      kind: input.kind,"""
assert old in s, "hide_maker_on_edge: the anchor has drifted"
s = s.replace(old, """      merchant: input.merchant,
      maker: "",
      kind: input.kind,""", 1)
p.write_text(s)
