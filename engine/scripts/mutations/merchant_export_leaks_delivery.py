import pathlib

# §14.1 and §7.5b. A shop's export gains the deliveries, so a platform move
# hands the receiving platform every household's delivery code.

p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
a = "    notes,\n    recoveries,\n  };"
assert a in s, "node.ts merchant-export anchor has drifted"
s = s.replace(a, '    notes,\n    recoveries,\n    deliveries: [{ offer: "x", carriage: 550, code: "dc-probe-3", status: "delivered", updated_at: 0 }] as never,\n  };', 1)
p.write_text(s)
