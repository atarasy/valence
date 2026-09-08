import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace("""    const offer = this.mustGet(offerId, now);
    if (offer.state !== "presented") {
      throw conflict("bad_state", `cannot decide an offer in ${offer.state}`);
    }""",
"""    const offer = this.mustGet(offerId);
    if (offer.state !== "presented" && offer.state !== "expired") {
      throw conflict("bad_state", `cannot decide an offer in ${offer.state}`);
    }""", 1)
p.write_text(s)
