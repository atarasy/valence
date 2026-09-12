import pathlib

# §6.5. A household's signature over a box that has already settled is
# answered with the settlement that stands, rather than refused. **This is
# what the engine did until 2026-09-12**, on the reasoning that settling is
# idempotent: true of a presenter retrying after a timeout, and false of the
# person, whose signature is the application rather than a request for what
# already happened. Two tabs of one statement, the second disputing a line:
# the second tab read as signed, was told the first settlement's charge, and
# its dispute was recorded nowhere.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = """      if (confirmation.signed) {
        throw conflict(
          "already_settled",
          "this box has already settled, and this signature was not what settled it"
        );
      }
      return existing;"""
assert a in s, "offers.ts already-settled anchor has drifted"
s = s.replace(a, "      return existing;", 1)
p.write_text(s)
