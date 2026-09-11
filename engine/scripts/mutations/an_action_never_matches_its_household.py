import pathlib
# Clause 37, second break beside refuse_every_grant. The action is found and
# then judged to belong to somebody else, so every grant is refused by a check
# that is meant to catch one borrowed from another household. The other
# mutation loses the action; this one keeps it and reads it wrongly.
p = pathlib.Path("src/hub/permissions.ts"); s = p.read_text()
old = '    if (action.household !== input.household) {'
assert old in s, "an_action_never_matches_its_household: the anchor has drifted"
s = s.replace(old, '    if (action.household === input.household) {', 1)
p.write_text(s)
