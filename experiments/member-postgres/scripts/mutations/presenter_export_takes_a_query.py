import pathlib
# VOX-11 (vault `72`). Let the export route accept a query, so that a caller
# can believe it chose whose records it reads.
p = pathlib.Path('presenter-http.ts'); s = p.read_text()
old = """ if(parts.length===1&&parts[0]==='export'&&method==='GET'){
  if(url.search)return reply(400,{error:'malformed',message:'this route takes no query'});
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, " if(parts.length===1&&parts[0]==='export'&&method==='GET'){\n", 1)
p.write_text(s)
