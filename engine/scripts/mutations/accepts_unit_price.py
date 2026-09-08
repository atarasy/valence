import pathlib
h = pathlib.Path("src/http.ts"); s = h.read_text()
s = s.replace('          ["product", "quantity", "predicted_conversion", "is_exploration"],',
              '          ["product", "quantity", "predicted_conversion", "is_exploration", "unit_price"],', 1)
h.write_text(s)
e = pathlib.Path("src/engine/offers.ts"); t = e.read_text()
t = t.replace("      predicted_conversion: number | null;\n      is_exploration: boolean;\n    }[];",
              "      predicted_conversion: number | null;\n      is_exploration: boolean;\n      unit_price?: number;\n    }[];", 1)
t = t.replace("        unit_price: entry.price,", "        unit_price: (c as { unit_price?: number }).unit_price ?? entry.price,", 1)
e.write_text(t)
