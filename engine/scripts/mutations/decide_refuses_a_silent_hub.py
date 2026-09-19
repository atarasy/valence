import pathlib
# §16.3, §16.5, decided 2026-09-20 after the second refutation pass over
# question 68. A read that fails refuses the decision again. Against a hub
# built one day earlier, a household's refusal of a gift is refused
# `hub_refused`, the offer reaches its expiry with every line still `offered`,
# §12 defaults them, and the giver is charged for goods the recipient declined.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """async function readOrUnknown(read: () => Promise<number | null>): Promise<Fixed> {
  try {
    return await read();
  } catch {
    return "unknown";
  }
}"""
assert s.count(old) == 1, "anchor drifted"
new = """async function readOrUnknown(read: () => Promise<number | null>): Promise<Fixed> {
  return await read();
}"""
s = s.replace(old, new, 1)
p.write_text(s)
