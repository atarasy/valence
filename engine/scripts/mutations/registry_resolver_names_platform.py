# Clause 6: add a platform only to single-entry resolution. The list is
# unchanged, so the list-only probe cannot catch this response-surface break.
from pathlib import Path
p = Path("src/shared/registry.ts")
s = p.read_text()
a = '    if (!entry) throw notFound(`no entry for ${merchant}`);\n    return entry;'
assert s.count(a) == 1, "registry resolver anchor has drifted"
p.write_text(s.replace(a, '    if (!entry) throw notFound(`no entry for ${merchant}`);\n    return { ...entry, platform: "atarasy-hosted" } as Entry;', 1))
