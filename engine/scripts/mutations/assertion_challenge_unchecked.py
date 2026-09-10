import pathlib

# §10.5. Accept an assertion without checking that its challenge is this
# decided set. What remains is proof that a person was present, which is what a
# random challenge would give: clause 35 asks what they agreed to, and this
# would confirm a set they never saw.

p = pathlib.Path("src/shared/decisions.ts"); s = p.read_text()
a = "    if (parsed.challenge !== challengeFor(offerId, decisions)) return false;"
assert a in s, "decisions.ts challenge anchor has drifted"
s = s.replace(a, "    void parsed.challenge;", 1)
p.write_text(s)
