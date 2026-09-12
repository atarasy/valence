import pathlib

# Clause 12. The approval surface names the merchant again where the maker
# should be. The clause asks for who made it "on the screen a person signs
# from as much as in the record", and until 2026-09-12 the screen carried no
# maker at all, so a probe that only checks the field is present would have
# passed a screen that fills it with the seller's name, which is the defect
# question 32 removed from the candidate.

p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
a = "        maker: c.maker,"
assert a in s, "approval.ts maker anchor has drifted"
s = s.replace(a, "        maker: c.merchant,", 1)
p.write_text(s)
