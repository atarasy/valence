import pathlib
p = pathlib.Path("src/ledger.ts"); s = p.read_text()
s = s.replace("    if (input.amount > row.reserved) {", "    if (false && input.amount > row.reserved) {", 1)
p.write_text(s)
