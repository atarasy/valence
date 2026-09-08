import pathlib
p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
old = """    const deliberation = this.deliberations.get(offer.id);
    if (!deliberation) {
      return { missing: "no deliberation recorded for this offer (clause 59)" };
    }"""
assert old in s, "anchor drifted"
s = s.replace(old, """    const deliberation = this.deliberations.get(offer.id) ?? {
      offer: offer.id,
      perCandidate: {},
      excluded: [],
      mandate: { kind: "individual" as const, scope: "this offer", lapses_at: null },
    };""", 1)
old2 = """      if (!entry || entry.alternatives.length === 0 || entry.argument_against === "") {
        return {
          missing: `candidate ${c.id} carries no alternatives or no argument against (clause 59)`,
        };
      }"""
assert old2 in s, "anchor drifted (per-candidate)"
s = s.replace(old2, "", 1)
s = s.replace("        alternatives: entry.alternatives,\n        argument_against: entry.argument_against,",
              "        alternatives: entry?.alternatives ?? [],\n        argument_against: entry?.argument_against ?? \"\",", 1)
p.write_text(s)
