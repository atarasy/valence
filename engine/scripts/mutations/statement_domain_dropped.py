import pathlib
# §6.5. Remove only the statement domain tag, retaining the offer, carriage
# and line bytes. The earlier target also removed carriage and could not
# isolate domain separation from carriage binding.
p = pathlib.Path("src/shared/statement.ts"); s = p.read_text()
a = "  return Buffer.from([STATEMENT_DOMAIN, offerId, String(carriage), ...body].join(\"\\n\"), \"utf8\");"
assert s.count(a) == 1, "shared/statement.ts domain anchor has drifted"
s = s.replace(a, "  return Buffer.from([offerId, String(carriage), ...body].join(\"\\n\"), \"utf8\");", 1)
p.write_text(s)
