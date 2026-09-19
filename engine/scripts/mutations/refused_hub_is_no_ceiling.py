import pathlib
# §13.1, §16.2. The other half of the same sentence: a hub that answers and
# refuses read as one holding nothing for this household, on both reads.
# `hub_refused` is named in the specification and was asserted nowhere until
# 2026-09-20.
p = pathlib.Path("src/engine/mandate-source.ts"); s = p.read_text()
old = """    if (!response.ok) {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${response.status} for mandate ${id}`
      );
    }"""
assert s.count(old) == 1, "anchor drifted (get)"
s = s.replace(old, "    if (!response.ok) {\n      return undefined;\n    }", 1)
old = """    if (!response.ok) {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${response.status} for the mandates of ${household}`
      );
    }"""
assert s.count(old) == 1, "anchor drifted (household)"
new = """    if (!response.ok) {
      return { has: false, ceiling_daily: null, ceiling_out_of_network: null, cooling_seconds: null };
    }"""
s = s.replace(old, new, 1)
p.write_text(s)
