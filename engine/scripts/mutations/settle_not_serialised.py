import pathlib
# §16.3, question 66. Let two settles of one payer run at once, so both read
# the day before either writes it.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '''    const prior = this.settling.get(payer) ?? Promise.resolve();
'''
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '''    const prior = Promise.resolve();
''', 1)
p.write_text(s)
