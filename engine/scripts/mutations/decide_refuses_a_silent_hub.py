import pathlib
# §16.3, §16.5, decided 2026-09-20 after the second refutation pass over
# question 68 and re-anchored after the third. A read that fails refuses the
# decision again, for a household this host has read before. Against a hub
# built one day earlier, a household's refusal of a gift is refused
# `hub_refused`, the offer reaches its expiry with every line still `offered`,
# §12 defaults them, and the giver is charged for goods the recipient declined.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """    } catch (err) {
      if (!this.lastProtectionRead.has(key)) throw err;
      return { value: this.lastProtectionRead.get(key) ?? null, stale: true };
    }"""
assert s.count(old) == 1, "anchor drifted"
new = """    } catch (err) {
      throw err;
    }"""
s = s.replace(old, new, 1)
p.write_text(s)
