import pathlib
# §14.2, question 56. Leave the claims out of the export, so an offer that
# moved with its mandate names a mandate the next archive does not carry and
# the record of what the household had stops at the first host it left.
p = pathlib.Path('src/hub/node.ts'); s = p.read_text()
old = '    mandates: [...mandates.forHousehold(household), ...mandates.claimsFor(household)],\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    mandates: mandates.forHousehold(household),\n', 1))
