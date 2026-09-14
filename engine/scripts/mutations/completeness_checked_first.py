import pathlib
# §11.2, question 46. Completeness is read before every other rule, so a body
# that breaks two rules names a different refusal than the specification
# orders, and an implementation built from the text fails the probe.
p = pathlib.Path("src/engine/physical.ts"); s = p.read_text()
block = """    const unnamed = input.candidates.filter((c) => c.valence === "offered" && !named.includes(c.id));
    if (unnamed.length > 0) {
      throw unprocessable(
        "collection_incomplete",
        `name every undecided item as returned, consumed or missing: ${unnamed.map((c) => c.id).join(", ")}`
      );
    }
"""
assert s.count(block) == 1, "completeness anchor drifted"
s = s.replace(block, "", 1)
known = "    const known = new Set(input.candidates.map((c) => c.id));\n"
assert s.count(known) == 1, "known anchor drifted"
s = s.replace(known, known + block, 1)
p.write_text(s)
