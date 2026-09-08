import pathlib
p=pathlib.Path("src/engine/offers.ts"); s=p.read_text()
s=s.replace("    const config = this.configs.get(input.config_version);",
"""    let config = this.configs.get(input.config_version);
    for (const c of this.configs.values()) { config = c; break; }""",1)
p.write_text(s)
