import pathlib
# Clause 19 and section 7.6, second break beside history_from_receipt, in the
# engine rather than on the route. A receipt keeps the product it was for, so
# a recipient's record becomes a purchase history: the clause says a
# recipient's profile starts empty beyond the fact of receipt.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = '  receiptsFor(household: string): { ref: string; at: number }[] {\n    return this.receipts.get(household) ?? [];'
assert old in s, "receipt_names_its_product: the anchor has drifted"
s = s.replace(old, '  receiptsFor(household: string): { ref: string; at: number }[] {\n    return (this.receipts.get(household) ?? []).map((r) => ({ ...r, product: "tea" })) as { ref: string; at: number }[];', 1)
p.write_text(s)
