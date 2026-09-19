import pathlib
# §16.3, question 66. Answer a retried settle with the settlement and tell the
# day nothing, so a report that failed leaves the day short for good.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '''      return this.reportDay(existing);
    }
    if (offer.state !== "decided" && offer.state !== "expired") {'''
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '''      return existing;
    }
    if (offer.state !== "decided" && offer.state !== "expired") {''', 1)
p.write_text(s)
