import pathlib
# §16.3, §11.2, decided 2026-09-19. The collection route goes through the
# synchronous `collect`, which checks every rule of the collection and fixes
# nothing, so a box its collection decided keeps no ceiling.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        const collected = await engine.collectDeciding({'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        const collected = engine.collect({', 1)
p.write_text(s)
