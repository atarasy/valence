import pathlib
# §11: consumed and lost are the collection's. Let a household decide them.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "      throw unprocessable(\n        \"not_decidable\",\n        `${valence} is recorded by the collection or the deadline, not decided`\n      );"
assert old in s
s = s.replace(old, "      if (offer.binding !== \"physical\") throw unprocessable(\"binding_mismatch\", \"physical only\");", 1)
p.write_text(s)
