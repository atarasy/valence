import pathlib

# §16.5, question 43. A set the household never signed can be taken back.
# **This is what the engine did until 2026-09-13.** A physical box reaches
# `decided` when a collection resolves its last line, and the withdrawal then
# returned it to `presented` with the collection's verdicts intact: the box
# reached no section of the household's own list, its signature over the
# original statement was refused as out of state, and §6.5's block lifted, so
# a presenter that withdrew the box left the consumed goods charged to nobody.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """    if ((this.confirmations.get(offer.id) ?? []).length === 0) {
      throw conflict(
        "not_withdrawable",
        "no confirmation is recorded for this set, because a collection resolved it or it arrived without one, so there is nothing to withdraw"
      );
    }
"""
assert a in s, "offers.ts not_withdrawable anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)
