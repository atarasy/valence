import pathlib
# §6.4, §13.2, question 62. Report to the day before marking the offer settled,
# and do not mend a settlement whose offer was never marked, so a failed report
# leaves an offer nothing can withdraw, settle or move.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (existing && offer.state !== "settled") {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false) {\n', 1)
old = '    offer.state = "settled";\n    this.commit(offer);\n    return this.reportDay(settlement);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    await this.reportDay(settlement);\n    offer.state = "settled";\n    this.commit(offer);\n    return settlement;\n', 1)
p.write_text(s)
