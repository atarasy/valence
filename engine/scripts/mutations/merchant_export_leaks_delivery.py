import pathlib

# §14.1 and §7.5b. Add a synthetic delivery-shaped row to the shop's export.
# The replacement contains the literal probe marker dc-probe-3; it does not
# read the delivery register. In the completed original 299 mutation log,
# reviewed 2026-09-13, the no-marker assertion fails on that injected string.
# This proves detection of the synthetic payload, not export of actual
# household delivery records.

p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
a = "    notes,\n    recoveries,\n  };"
assert a in s, "node.ts merchant-export anchor has drifted"
s = s.replace(a, '    notes,\n    recoveries,\n    deliveries: [{ offer: "x", carriage: 550, code: "dc-probe-3", status: "delivered", updated_at: 0 }] as never,\n  };', 1)
p.write_text(s)
