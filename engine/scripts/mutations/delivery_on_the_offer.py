import pathlib

# Clause 49 and §7.5b. Serialise the delivery onto the offer, where a merchant
# reads it. A carrier's code is not an address and resolves to one, so this is
# the merchant learning where the household lives with no field for an address
# anywhere in the response.

p = pathlib.Path("src/http.ts"); s = p.read_text()
a = '      if (method === "GET" && action === "delivery") {'
assert a in s, "http.ts delivery route anchor has drifted"
s = s.replace(a, '''      if (method === "GET" && action === "offer_with_delivery_leak") {
        return json(engine.offer(id));
      }
      if (method === "GET" && action === "delivery") {''', 1)
p.write_text(s)

# the leak that matters: put it on the offer serialisation itself
q = pathlib.Path("src/engine/offers.ts"); t = q.read_text()
b = "        unit_price: entry.price,"
assert b in t, "offers.ts candidate serialisation anchor has drifted"
t = t.replace(b, '        unit_price: entry.price,\n        code: "dc-probe-2", carriage: 550,', 1)
q.write_text(t)
