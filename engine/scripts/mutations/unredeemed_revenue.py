import pathlib
# Clause 25: if nothing was chosen, a default ships. Remove the branch, so an
# unredeemed ceremonial offer expires with everything returned and the giver's
# band is kept by the presenter.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = '''    if (offer.purpose === "ceremonial" && undecided.length > 0 && nothingKept) {
      const first = undecided[0]!;
      first.valence = "defaulted";
      first.decided_at = now;
    }
'''
assert old in s
s = s.replace(old, "", 1)
p.write_text(s)
