import pathlib

# §6.5, §11, clause 43. The node export leaves out what the route found in
# each physical box. The offers move with their `consumed` valences and the
# receiving host has no record that any collection happened, so §6.5's block
# lifts on the move: the household's next box comes while a statement stands
# unsigned, and the sending host holds a block over a household that has left.
# The merchant's export carries the rows either way, so the shop keeps what
# the person loses.

p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
a = """    collections: offers
      .map((o) => engine.recoveries.for(o.id))
      .filter((r): r is Recovery => r !== undefined),
"""
assert a in s, "node.ts collections anchor has drifted"
s = s.replace(a, "    collections: [],\n", 1)
p.write_text(s)
