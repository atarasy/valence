import pathlib
# §6.5. A disputed line says `disputed: false`, while the disputed_amount
# accumulator and the charge remain correct. A disposable reproduction
# against 22a6784 on 2026-09-13 retained disputed_amount 1500 and charged 900;
# only the line's dispute flag changed. It mislabels the line as confirmed,
# rather than removing every record of the dispute.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "          line(c, amount, true);"
assert a in s, "offers.ts disputed line anchor has drifted"
s = s.replace(a, "          line(c, amount, false);", 1)
p.write_text(s)
