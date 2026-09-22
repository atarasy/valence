import pathlib
# Question 70. Remove the presenter surface's own unknown-field refusal for a
# posted correction, so a body carrying an extra field reaches the engine
# unrefused at this layer.
p = pathlib.Path('presenter-http.ts'); s = p.read_text()
old = "   if(Object.keys(b).some(k=>!allowed.includes(k)))return reply(400,{error:'malformed',message:'a correction has only id, merchant, amount, kind, note, corrected_at and signature'});\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "", 1)
p.write_text(s)
