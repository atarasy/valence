import pathlib

# §7.5b. Remove the household's read of its own delivery. The wall around the
# merchant is proven by delivery_on_the_offer and merchant_export_leaks_delivery;
# nothing proved that the surface the wall protects exists at all, which left
# the control probe unproven from the day it was written (2026-09-10).

p = pathlib.Path("src/http.ts"); s = p.read_text()
a = '      if (method === "GET" && action === "delivery") {\n        return json(deliveries.mustGet(id));\n      }'
assert a in s, "http.ts delivery GET anchor has drifted"
s = s.replace(a, '      if (method === "GET" && action === "delivery") {\n        throw notFound(`offer ${id} has no delivery`);\n      }', 1)
p.write_text(s)
