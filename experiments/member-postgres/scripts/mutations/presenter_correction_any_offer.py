import pathlib
# Question 70. Escape the ownership guard for the presenter corrections
# routes alone, so a presenter can read or append a correction to an offer
# another presenter made.
p = pathlib.Path('presenter-http.ts'); s = p.read_text()
old = "if(owner!==presenter)return reply(404,{error:'offer_unavailable',message:'no such offer for this presenter'});"
assert s.count(old) == 1, "anchor drifted"
new = "if(owner!==presenter&&!(parts.length===3&&parts[2]==='corrections'))return reply(404,{error:'offer_unavailable',message:'no such offer for this presenter'});"
s = s.replace(old, new, 1)
p.write_text(s)
