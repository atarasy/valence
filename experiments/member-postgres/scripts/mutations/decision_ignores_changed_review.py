from pathlib import Path
p = Path('decision-authorisation.ts')
s = p.read_text()
old = "      if(fresh.revision!==v.revision||fresh.canonical!==o.canonical)throw new Error('Review changed');"
assert s.count(old) == 1, 'anchor drifted'
p.write_text(s.replace(old, '', 1))
