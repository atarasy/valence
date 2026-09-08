import pathlib
p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
old = "        alternatives: entry.alternatives,"
assert old in s, "anchor drifted"
s = s.replace(old, "        banner: \"a nice picture\",\n        rank: 1,\n        alternatives: entry.alternatives,", 1)
s = s.replace("""export type ApprovalCandidate = {""", """export type ApprovalCandidate = {
  banner?: string;
  rank?: number;""", 1)
p.write_text(s)
