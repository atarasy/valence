import pathlib
# §13.2, §14.2, question 55. Let an arriving offer name any mandate. An import
# does not pass through `createOffer`, so the shape holds for an offer made
# here and not for one that arrived.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (typeof o.mandate !== "string" || householdOfMandate(o.mandate) !== moving) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '        if (false) {\n', 1))
