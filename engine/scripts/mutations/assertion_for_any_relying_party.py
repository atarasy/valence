import pathlib

# §10.5, §14b. Stop comparing the relying party hash, so an assertion a
# member's device made for some other hub, with this set as its challenge and
# a good signature, confirms the set here. This is what the reference did
# until 2026-09-11, when nothing told an engine its own name.

p = pathlib.Path("src/shared/decisions.ts"); s = p.read_text()
a = '    if (!authenticatorData.subarray(0, 32).equals(relyingParty)) return false;'
assert a in s, "decisions.ts relying party anchor has drifted"
s = s.replace(a, "    void relyingParty;", 1)
p.write_text(s)
