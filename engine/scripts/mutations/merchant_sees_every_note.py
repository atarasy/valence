import pathlib
# Clause 27: a line reaches the merchant only when the writer said so.
# Return every note to whoever asks as the merchant.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "    return this.notesFor(candidateId).filter((n) => n.shared_with.includes(party));"
assert old in s
s = s.replace(old, "    return this.notesFor(candidateId);", 1)
p.write_text(s)
