import pathlib

# Clause 43 and §14.1. The shop's own recovery rows, dropped from its export.
# A shop that ran the physical binding and moves platform would arrive without
# any record of what it placed and got back.

p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
a = "    notes,\n    recoveries,\n  };"
assert a in s, "node.ts merchant-export recoveries anchor has drifted"
s = s.replace(a, "    notes,\n    recoveries: [],\n  };", 1)
p.write_text(s)
