import pathlib
# §14.2, question 53. Keep the candidate index outside the journal, so a failed
# import leaves its candidates indexed and the retry of the same move is refused
# as a candidate conflict.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '  private readonly candidateIndex = transientMap<string>();\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '  private readonly candidateIndex = new Map<string, string>();\n', 1))
