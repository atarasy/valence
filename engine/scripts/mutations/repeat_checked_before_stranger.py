import pathlib
# §11.2, question 46. The repeated-verdict rule is read before the stranger
# rule, so a body naming both an id of no candidate and one candidate twice is
# told returned_and_consumed instead of unknown_candidate, against the order the
# specification states.
p = pathlib.Path("src/engine/physical.ts"); s = p.read_text()
strangers = """    const strangers = named.filter((id) => !known.has(id));
    if (strangers.length > 0) {
      throw unprocessable("unknown_candidate", `not candidates of this offer: ${strangers.join(", ")}`);
    }
"""
assert s.count(strangers) == 1, "stranger anchor drifted"
s = s.replace(strangers, "", 1)
after_repeat = """        `a candidate cannot carry two verdicts in one collection: ${[...new Set(repeated)].join(", ")}`
      );
    }
"""
assert s.count(after_repeat) == 1, "repeat anchor drifted"
s = s.replace(after_repeat, after_repeat + strangers, 1)
p.write_text(s)
