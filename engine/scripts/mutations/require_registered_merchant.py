import pathlib
# Clause 13: taking part requires no registration. Refuse an offer whose
# candidates name a merchant the registry does not list, which turns the
# registry into a gate.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "      const offer = engine.createOffer({"
assert s.count(old) == 1
new = """      const gated = engine.createOffer({"""
s = s.replace(old, new, 1)
old2 = "        mandate: requireString(raw, \"mandate\", \"offer\"),"
assert s.count(old2) == 1
# find the end of the createOffer call after old2 and add the gate
idx = s.index(old2)
end = s.index("});", idx) + 3
s = s[:end] + """
      for (const c of gated.candidates) {
        try { registry.resolve(c.merchant); } catch { throw unprocessable("unregistered_merchant", `${c.merchant} is not listed`); }
      }
      const offer = gated;""" + s[end:]
if "unprocessable" not in s.split("\\n")[0:40].__str__():
    pass
p.write_text(s)
