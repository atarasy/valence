import pathlib
# Clause 46, question 65. Read the recipient's out-of-network ceiling for a
# gift the giver pays, as question 64's build did. The household's own branch,
# question 68's, is left as it is.
# Re-anchored when question 68 was rebased onto questions 65 to 67.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '''    const ceiling = offer.giver
      ? await this.outOfNetworkRead(offer.giver, now)
'''
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '''    const ceiling = offer.giver
      ? mandate?.ceiling_out_of_network ?? null
''', 1)
p.write_text(s)
