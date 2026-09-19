import pathlib
# §13.1, §16.2. A hub that cannot be reached read as one saying the household
# has set no protection. `hub_unreachable` is the refusal §13.1 names for it,
# and until 2026-09-20 nothing in the suites or in `engine/test/` asserted it.
# Under this break an offer entirely outside the network presents past the
# ceiling the household set, because the socket refused.
p = pathlib.Path("src/engine/mandate-source.ts"); s = p.read_text()
old = """    } catch (err) {
      throw unprocessable(
        "hub_unreachable",
        `the hub holding the mandates of ${household} could not be reached: ${(err as Error).message}`
      );
    }"""
assert s.count(old) == 1, "anchor drifted"
new = """    } catch {
      return { has: false, ceiling_daily: null, ceiling_out_of_network: null, cooling_seconds: null };
    }"""
s = s.replace(old, new, 1)
p.write_text(s)
