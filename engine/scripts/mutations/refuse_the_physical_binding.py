import pathlib
p=pathlib.Path("src/engine.ts"); s=p.read_text()
s=s.replace("""    if (input.candidates.length < 1) {""",
"""    if (input.binding === "physical") {
      throw badRequest("malformed", "physical offers are not accepted");
    }
    if (input.candidates.length < 1) {""",1); p.write_text(s)
