import pathlib
# Section 13.1, second break beside roles_are_swapped. The roles are not
# exchanged and the gate is widened: a role that owns a route also answers for
# one it does not own, so a deployment presenting the person's side alone
# answers for the presenter's too. A deployment is judged on the surface it
# presents, and a surface it may quietly extend is not one.
p = pathlib.Path("src/common/roles.ts"); s = p.read_text()
old = '  return owner === "either" ? roles.size > 0 : roles.has(owner);'
assert old in s, "the_hub_answers_for_offers: the anchor has drifted"
s = s.replace(old, '  return owner === "either" ? roles.size > 0 : roles.has(owner) || roles.has("hub");', 1)
p.write_text(s)
