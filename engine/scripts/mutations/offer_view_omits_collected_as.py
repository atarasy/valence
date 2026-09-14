import pathlib

# §3, question 48. The offer and the household list carry collected_as as null while the approval carries it, so the two surfaces a hub draws from disagree.

p = pathlib.Path("src/http.ts"); s = p.read_text()
a = '    collected_as: collectedAs(recovery, c.id),'
assert a in s, "src/http.ts offer_view_omits_collected_as anchor has drifted"
s = s.replace(a, '    collected_as: null,', 1)
p.write_text(s)
