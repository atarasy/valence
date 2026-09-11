import pathlib
# Clause 27, second break beside notes_summary_route. The lines stay where
# they are and the response counts them, which turns what one person wrote to
# another into a number about a product. A count is the smallest possible
# summary and the one nobody argues about adding.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '    return json({ notes: notes.map((n) => ({ text: n.text, created_at: n.created_at })) });'
assert old in s, "notes_carry_a_count: the anchor has drifted"
s = s.replace(old, '    return json({ count: notes.length, notes: notes.map((n) => ({ text: n.text, created_at: n.created_at })) });', 1)
p.write_text(s)
