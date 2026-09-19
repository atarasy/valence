import pathlib
# Clause 47, §16.2, question 68. Read the out-of-network ceiling of the mandate
# the offer names alone, as before the question: a household that had tightened
# one label then presents under a second it recorded by itself.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = """      const ceiling = offer.giver
        ? mandate.ceiling_out_of_network
        : Math.min(
            mandate.ceiling_out_of_network,
            (await this.mandateSource.outOfNetworkCeilingOf(offer.household)) ?? Infinity
          );
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "      const ceiling = mandate.ceiling_out_of_network;\n", 1)
p.write_text(s)
