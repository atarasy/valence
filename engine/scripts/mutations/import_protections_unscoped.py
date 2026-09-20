import pathlib
# §14.2, question 52, decided 2026-09-20. A record of what a set was decided
# under taken for any offer id, so a body carrying nothing else fixes a window
# on an offer the host already holds, and the window is the interval
# `DELETE /offers/{id}/decisions` is open inside (§16.5).
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = """      for (const id of Object.keys(body_.decided_protections ?? {})) {
        if (!carried.has(id)) {
          throw unprocessable("unscoped_protections", `a record of what a set was decided under names ${id}, which this import does not carry`);
        }
      }"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "", 1)
p.write_text(s)
