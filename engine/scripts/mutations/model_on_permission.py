import pathlib
p = pathlib.Path("src/permissions.ts"); s = p.read_text()
old = "      revoked_at: null,\n    };"
assert old in s, "anchor drifted"
s = s.replace(old, "      revoked_at: null,\n      model: \"some-llm-4\",\n    } as Permission;", 1)
p.write_text(s)
