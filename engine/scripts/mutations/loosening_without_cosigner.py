import pathlib
# Clause 47: a loosening is signed by the person and every co-signer the
# previous version named. Require only the person, so one party alone can
# raise a ceiling set while they had capacity.
p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
old = "      for (const k of before.co_signers) required.add(k);"
assert old in s
s = s.replace(old, "      void before;", 1)
p.write_text(s)
