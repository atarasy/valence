import pathlib
# Clause 20: no route lists what a household has received. Register one,
# returning the products behind the household's receipts.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '  if (parts[0] === "households" && parts[1] && parts[2] === "export") {'
assert s.count(old) == 1
new = '''  if (parts[0] === "households" && parts[1] && parts[2] === "received" && method === "GET") {
    const household = decodeURIComponent(parts[1]);
    const products = engine.unionForHousehold(household).flatMap((o) =>
      o.candidates.filter((c) => c.kept_as === "gift").map((c) => c.product)
    );
    return json({ received: products });
  }
''' + old
s = s.replace(old, new, 1)
p.write_text(s)
