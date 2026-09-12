import pathlib
# §6.5. The settlement records no confirmation, so what proves the household
# applied for the consumed lines is gone from the one durable record of the
# sale. The charge is right and the evidence is not there.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "      confirmation: signed,"
assert a in s, "offers.ts confirmation anchor has drifted"
s = s.replace(a, "      confirmation: null,", 1)
p.write_text(s)
