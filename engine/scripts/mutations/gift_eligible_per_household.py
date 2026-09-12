import pathlib

# §7.6b, 令和5年内閣府告示第19号. The offer view carries a per-household gift
# eligibility. An eligibility a maker can set for one household is one it can
# set for the household that wrote about the last gift, which is the inference
# the 告示 forbids written into the protocol rather than left to a merchant's
# own conduct.

p = pathlib.Path("src/http.ts"); s = p.read_text()
a = "    mandate: o.mandate,\n"
assert a in s, "http.ts offerView mandate anchor has drifted"
s = s.replace(a, a + "    gift_eligible: o.candidates.some((c) => c.given_by !== null),\n", 1)
p.write_text(s)
