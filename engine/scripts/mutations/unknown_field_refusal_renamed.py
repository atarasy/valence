"""Break the error name required by section 3.3 while preserving status 400."""
from pathlib import Path
p = Path("src/common/validate.ts")
s = p.read_text()
old = '\n      "malformed",\n      `${where}: no such field:'
assert s.count(old) == 1, "unknown-field refusal anchor moved"
p.write_text(s.replace(old, old.replace('"malformed"', '"unknown_field"'), 1))
