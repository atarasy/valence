import pathlib
# §12, clause 24, question 61. A payment carries the settlement's lines, which
# name what the recipient chose, to the giver's export.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '.map((st) => ({ offer: st.offer, presenter: st.signed_by, settled_at: st.settled_at, charged: st.charged, receipt: st.receipt }));'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '.map((st) => ({ offer: st.offer, presenter: st.signed_by, settled_at: st.settled_at, charged: st.charged, receipt: st.receipt, lines: st.lines }) as Payment);', 1)
p.write_text(s)
