import pathlib
# §13.1, §16.2. A hub that cannot be reached read as one holding nothing for
# this household, on both reads that say so: the mandate the offer names and
# the household's own protections. `hub_unreachable` is the refusal §13.1
# names for it, and until 2026-09-20 nothing in the suites or in `engine/test/`
# asserted it. Under this break an offer presents past the ceiling the
# household set and settles past its daily one, because the socket refused.
p = pathlib.Path("src/engine/mandate-source.ts"); s = p.read_text()
old = """    } catch (err) {
      throw unprocessable(
        "hub_unreachable",
        `the hub holding mandate ${id} could not be reached: ${(err as Error).message}`
      );
    }"""
assert s.count(old) == 1, "anchor drifted (get)"
s = s.replace(old, "    } catch {\n      return undefined;\n    }", 1)
old = """    } catch (err) {
      throw unprocessable(
        "hub_unreachable",
        `the hub holding the mandates of ${household} could not be reached: ${(err as Error).message}`
      );
    }"""
assert s.count(old) == 1, "anchor drifted (household)"
new = """    } catch {
      return { has: false, ceiling_daily: null, ceiling_out_of_network: null, cooling_seconds: null };
    }"""
s = s.replace(old, new, 1)
p.write_text(s)
