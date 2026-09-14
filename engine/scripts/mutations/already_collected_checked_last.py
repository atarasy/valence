import pathlib
# §11.2, question 46. The repeat is read after the first-collection rules, so
# a second collection naming a decided line is told candidate_decided instead
# of already_collected, against the order the specification states.
p = pathlib.Path("src/engine/physical.ts"); s = p.read_text()
block = """    if (row.collected_at !== null) {
      throw conflict("already_collected", "this offer has already been collected");
    }
"""
assert s.count(block) == 1, "repeat anchor drifted"
s = s.replace(block, "", 1)
write = "    row.returned = [...input.returned];\n"
assert s.count(write) == 1, "write anchor drifted"
s = s.replace(write, block + write, 1)
p.write_text(s)
