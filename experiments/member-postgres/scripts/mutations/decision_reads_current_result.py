from pathlib import Path
p = Path('decision-authorisation.ts')
s = p.read_text()
old = 'decision:v.result'
assert s.count(old) == 1, 'anchor drifted'
p.write_text(s.replace(old, "decision:o.state==='committed'?r.engine.mustGet(o.offer,clock()):null", 1))
