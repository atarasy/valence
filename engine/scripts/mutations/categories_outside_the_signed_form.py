import pathlib
# Section 16.1, second break beside mandate_form_is_malleable. Leave the
# categories out of the signed bytes entirely, so a relay can add or drop one
# without touching the signature. The other mutation makes the list malleable;
# this one takes it out of the form.
p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
old = '      [...m.co_sign_categories].sort().map(encodeURIComponent).join(","),'
assert old in s, "categories_outside_the_signed_form: the anchor has drifted"
s = s.replace(old, '      "",', 1)
p.write_text(s)
