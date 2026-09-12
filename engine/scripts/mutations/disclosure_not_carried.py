import pathlib
# §10a.4. An offer carries no disclosure, so a person signs without seeing what
# the seller had to say. The blocks are recorded and simply not frozen onto the
# offer, which is the shape this arrives in when a deployment treats the
# disclosure as something to fetch later.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """      disclosures: [
        ...new Map("""
assert old in s, "disclosure_not_carried: the anchor has drifted"
s = s.replace(old, """      disclosures: [
        ...new Map<string, import("../shared/disclosure.js").Disclosure>(), ...new Map(""", 1)
p.write_text(s)
