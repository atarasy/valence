import pathlib
# §5.4 revision 2. Collapse merchant/maker into one ambiguous colon-joined
# string. The existing separator-boundary unit test must reject this form.
# Like the previous unescaped-join mutation, this is measured by unit tests.
p = pathlib.Path("src/shared/catalogue.ts")
s = p.read_text()
old = "return [ref,e.merchant,e.maker,e.ships,e.price,e.category ?? null,physical];"
assert s.count(old) == 1, "catalogue_form_is_malleable: the anchor has drifted"
s = s.replace(old, 'return [ref,e.merchant + ":" + e.maker,e.ships,e.price,e.category ?? null,physical];', 1)
p.write_text(s)
