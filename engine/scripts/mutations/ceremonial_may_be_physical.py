import pathlib

# §12, §6.5. A ceremonial offer is accepted in the physical binding, where
# clause 25 charges the giver and §6.5 asks the household to sign the
# settlement statement: the party charged takes no act and the party that acts
# pays nothing, which is the premise §6.5 rests on. The statement cannot be
# given to the giver instead, because it lists what the recipient used.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """      if (input.binding === "physical") {
        throw unprocessable(
          "ceremonial_is_digital",
"""
assert a in s, "offers.ts ceremonial binding anchor has drifted"
s = s.replace(a, """      if (false) {
        throw unprocessable(
          "ceremonial_is_digital",
""", 1)
p.write_text(s)
