import pathlib

# §10.5, §16.5. Stop refusing confirmations already used for this offer, so the
# bytes that confirmed a decided set stay good after the person takes it back.
# Anything that saw the confirmation once can then undo the withdrawal, which
# is the window clause 47 gives a person to change their mind.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = '''    if (used.includes(confirmation)) {'''
assert a in s, "offers.ts confirmation anchor has drifted"
s = s.replace(a, "    if (false) {", 1)
p.write_text(s)
