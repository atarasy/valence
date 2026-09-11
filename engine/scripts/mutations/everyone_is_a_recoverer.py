import pathlib
# Clause 53, second break beside anyone_can_recover. Keep the membership check
# and answer it with the caller, so the check passes for whoever asks. The
# other mutation removes the guard; this one corrupts what it reads.
p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
old = '    const recoverers = this.recoverers.get(input.household) ?? [];'
assert old in s, "everyone_is_a_recoverer: the anchor has drifted"
s = s.replace(old, '    const recoverers = [input.by];', 1)
p.write_text(s)
