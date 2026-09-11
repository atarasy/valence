import pathlib
# Section 10.5. The challenge is compared against the empty bytes rather than
# against the decided set's, so no correct assertion verifies and the one
# shape a member with a passkey can send stops working. The probe this catches
# asserts the good case, which is the half of the pair that says the
# comparison is to the set: its neighbours assert refusals, and a check that
# refuses everything passes all of those.
p = pathlib.Path("src/shared/decisions.ts"); s = p.read_text()
old = "    if (parsed.challenge !== challengeForBytes(bytes)) return false;"
assert old in s, "the_challenge_is_any_set: the anchor has drifted"
s = s.replace(old, '    if (parsed.challenge !== challengeForBytes(Buffer.from(""))) return false;', 1)
p.write_text(s)
