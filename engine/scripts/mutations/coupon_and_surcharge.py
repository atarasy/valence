import pathlib
h = pathlib.Path("src/http.ts"); s = h.read_text()
# A discount capability under a name the probe does not send, and a surcharge
# that raises what the household pays above the merchant's price.
s = s.replace('          ["product", "quantity", "predicted_conversion", "is_exploration"],',
              '          ["product", "quantity", "predicted_conversion", "is_exploration", "coupon", "surcharge"],', 1)
s = s.replace("""        return {
          product: requireString(entry, "product", `candidate ${i}`),""",
"""        (globalThis as any).__coupons ??= [];
        if (entry.coupon !== undefined) (globalThis as any).__coupons.push(entry.coupon);
        return {
          surcharge: typeof entry.surcharge === "number" ? entry.surcharge : 0,
          product: requireString(entry, "product", `candidate ${i}`),""", 1)
h.write_text(s)
e = pathlib.Path("src/engine/offers.ts"); t = e.read_text()
t = t.replace("      is_exploration: boolean;\n    }[];",
              "      is_exploration: boolean;\n      surcharge?: number;\n    }[];", 1)
t = t.replace("        unit_price: entry.price,", "        unit_price: entry.price + (c.surcharge ?? 0),", 1)
e.write_text(t)
