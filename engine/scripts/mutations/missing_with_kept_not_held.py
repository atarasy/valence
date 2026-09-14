import pathlib
# §6.5, question 46 (2026-09-14). A box that carries a kept, defaulted or
# consumed line beside a missing line does not hold the next box, so a household
# receives the next delivery by never signing the statement it must still answer.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """        if (
          recovery.missing.length > 0 &&
          other.candidates.some((c) => c.valence === "kept" || c.valence === "defaulted" || c.valence === "consumed")
        ) {
          return true;
        }"""
assert s.count(old) == 1, "hold anchor drifted"
s = s.replace(old, "        if (false) {\n          return true;\n        }", 1)
p.write_text(s)
