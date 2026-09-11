import pathlib
# Section 17.2, second break beside registry_search. The parameter guard is
# widened by one name rather than removed, which is how a query by intent
# arrives: not as a search route but as one more allowed word.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '        if (key !== "protocol" && key !== "mark") {'
assert old in s, "registry_takes_a_query_parameter: the anchor has drifted"
s = s.replace(old, '        if (key !== "protocol" && key !== "mark" && key !== "q") {', 1)
p.write_text(s)
