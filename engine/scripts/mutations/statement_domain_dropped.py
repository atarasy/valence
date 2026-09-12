import pathlib
# §6.5. The domain tag leaves the statement's canonical bytes, so a statement
# and a decided set are signed over the same prefix in the same four-field
# shape, told apart only by the type of one field.
p = pathlib.Path("src/shared/statement.ts"); s = p.read_text()
a = "  return Buffer.from([STATEMENT_DOMAIN, offerId, String(carriage), ...body].join(\"\\n\"), \"utf8\");"
assert a in s, "shared/statement.ts domain anchor has drifted"
s = s.replace(a, "  return Buffer.from([offerId, ...body].join(\"\\n\"), \"utf8\");", 1)
p.write_text(s)
