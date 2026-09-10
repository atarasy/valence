import pathlib

# §10.5, §14.1. Leave the confirmation register out of a node's export, so a
# household that moves arrives with its offers and none of what confirmed
# them. A confirmation captured on the sending host then decides the moved
# offer on the receiving one, and the person changed hosts and left the
# protection behind.

p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
a = "    confirmations: engine.confirmationsFor(offers.map((o) => o.id)),"
assert a in s, "node.ts confirmations anchor has drifted"
s = s.replace(a, "    confirmations: {},", 1)
p.write_text(s)
