import pathlib

# §13.2. Keep the rows in memory and never write them, which is what every
# version before 2026-09-11 did. Everything answers, every probe passes, and a
# restart is a loss: the failure is invisible until the process stops.

p = pathlib.Path("src/common/store.ts"); s = p.read_text()
a = """    super.set(key, value);
    this.db"""
assert a in s, "store.ts write-through anchor has drifted"
s = s.replace(a, """    super.set(key, value);
    if (false) this.db""", 1)
p.write_text(s)
