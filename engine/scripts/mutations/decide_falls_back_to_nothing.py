import pathlib
# §16.3, §16.5, decided 2026-09-20 after the third refutation pass over
# question 68. A read that fails applies no protection at all instead of the
# last reading this host had. The pass measured one silent read at the
# decision taking away a day-long cooling window and a ceiling of 500, on a
# split deployment where the party that profits from the read failing is the
# party the decision arrives through.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """      if (!this.lastProtectionRead.has(key)) throw err;
      return { value: this.lastProtectionRead.get(key) ?? null, stale: true };"""
assert s.count(old) == 1, "anchor drifted"
new = """      if (false) throw err;
      return { value: null, stale: true };"""
s = s.replace(old, new, 1)
p.write_text(s)
