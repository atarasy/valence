import pathlib
p = pathlib.Path("src/meter-ledger.ts"); s = p.read_text()
# Delegate the ceiling to Meter, which is what an adapter author would do
# if they believed the architecture note rather than the code.
s = s.replace("    if (input.amount > row.reserved) {", "    if (false && input.amount > row.reserved) {", 1)
p.write_text(s)
