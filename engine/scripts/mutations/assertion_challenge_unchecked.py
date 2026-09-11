import pathlib

# §10.5, §16.1, §16.4. Accept an assertion without checking that its challenge
# is what was agreed to. What remains is proof that a person was present,
# which is what a random challenge would give: clause 35 asks what they agreed
# to, and this would confirm a set, or record a mandate, they never saw.
#
# Re-anchored 2026-09-11 when the check moved into the general verifier, which
# reads bytes rather than a decided set. `anchors.py` named the drift in
# seconds.

p = pathlib.Path("src/shared/decisions.ts"); s = p.read_text()
a = "    if (parsed.challenge !== challengeForBytes(bytes)) return false;"
assert a in s, "decisions.ts challenge anchor has drifted"
s = s.replace(a, "    void parsed.challenge;", 1)
p.write_text(s)
