import pathlib
# Clause 9, clause 38, question 52. Take an imported grant without the checks
# `grant` makes, so a move can carry a computation with no aggregate, a party
# with a result form, or the household as its own grantee.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (g.grantee === moving) throw unprocessable("own_agent"'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        if (false) throw unprocessable("own_agent"', 1)
old2 = '          if (g.result_form !== "aggregate") throw unprocessable("no_result_form"'
assert s.count(old2) == 1, "anchor drifted"
s = s.replace(old2, '          if (false) throw unprocessable("no_result_form"', 1)
p.write_text(s)
