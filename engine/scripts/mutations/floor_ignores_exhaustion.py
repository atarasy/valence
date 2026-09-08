import pathlib
# §5: the floor asks for what exists. Drop the cap, so a presenter that has
# offered a household everything can never offer it anything again.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "    const required = Math.min(\n      explorationFloor(candidates.length, this.config.explorationRate),\n      novelLeft\n    );"
assert old in s
s = s.replace(old, "    const required = explorationFloor(candidates.length, this.config.explorationRate);", 1)
p.write_text(s)
