import pathlib
# Question 70. Remove the household/presenter ownership check for a
# corrections receipt alone, so any signed-in session can read any offer's
# corrections regardless of whose household it belongs to.
p = pathlib.Path('../member-read/gate.ts'); s = p.read_text()
old = "return !!owner && owner.household === session.household && (route.resource.kind === 'mandate' || (typeof owner.presenter === 'string' && session.presenters.includes(owner.presenter)));"
assert s.count(old) == 1, "anchor drifted"
new = "return route.action === 'corrections' ? true : (!!owner && owner.household === session.household && (route.resource.kind === 'mandate' || (typeof owner.presenter === 'string' && session.presenters.includes(owner.presenter))));"
s = s.replace(old, new, 1)
p.write_text(s)
