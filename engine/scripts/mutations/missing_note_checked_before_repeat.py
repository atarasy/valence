import pathlib
# §11.2, question 46. The missing-note rule is read before the repeated-verdict
# rule, so a body naming one candidate both returned and missing, with no note,
# is told missing_note_required instead of returned_and_consumed, against the
# order the specification states.
p = pathlib.Path("src/engine/physical.ts"); s = p.read_text()
unexplained = """    const unexplained = missing.filter((id) => {
      const note = notes[id];
      return typeof note !== "string" || note.trim() === "" || [...note].length > MISSING_NOTE_LIMIT;
    });
    if (unexplained.length > 0) {
      throw unprocessable(
        "missing_note_required",
        `each missing item needs a note of 1 to ${MISSING_NOTE_LIMIT} characters: ${unexplained.join(", ")}`
      );
    }
"""
assert s.count(unexplained) == 1, "missing-note anchor drifted"
s = s.replace(unexplained, "", 1)
repeat = "    // One item, one verdict. The same id twice in one list is two verdicts too.\n"
assert s.count(repeat) == 1, "repeat anchor drifted"
s = s.replace(repeat, unexplained + repeat, 1)
p.write_text(s)
