import pathlib
p=pathlib.Path("src/hub/node.ts"); s=p.read_text()
s=s.replace("""    const rows = this.log.get(input.household) ?? [];
    rows.push(record);
    this.log.set(input.household, rows);""","",1); p.write_text(s)
