import pathlib
# §14.2, question 57. Leave nothing behind, so an offer whose money has not
# finished moving reaches the engine's refusal and the whole move is refused:
# one presented offer then stops a household with a weekly box from moving.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      const leftBehind = (body_.offers ?? []).filter((o) => moneyStillToMove(o, collectionOf.get(o.id))).map((o) => o.id);\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '      const leftBehind: string[] = [];\n', 1))
