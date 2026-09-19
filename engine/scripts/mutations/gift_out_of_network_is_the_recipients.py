import pathlib
# Clause 46, question 65. Read the recipient's out-of-network ceiling for a
# gift the giver pays, as question 64's build did.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '''    const ceiling = offer.giver
      ? await this.mandateSource.outOfNetworkCeilingOf(offer.giver)
      : mandate?.ceiling_out_of_network ?? null;
'''
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const ceiling = mandate?.ceiling_out_of_network ?? null;\n', 1)
p.write_text(s)
