import pathlib
# §16.5, §11.2. The cooling window resets the collection's own verdicts, so a
# household inside the window signs `returned` over goods it ate and settles
# at zero on a receipt that says they came back unopened. This is what the
# route did until a refutation pass measured it on 2026-09-12.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "      if (recorded.has(c.id)) continue;"
assert a in s, "offers.ts cooling reset anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)
