import pathlib

# §6.3. A settlement prices from the presenter's newest catalogue rather than
# the version stamped on the offer, so a presenter that raises a price after an
# offer is made is paid the new one for goods the household already has.
#
# **This script reported SURVIVED in the sweep of 291 and was not a survivor.**
# Its second replacement named `kept += c.unit_price * c.quantity;`, which the
# kept-gift fix of 2026-09-12 rewrote, so the pricing half silently did nothing
# while the first half went on selecting a different config and using it for
# nothing. `mutate.sh` asks only whether `src` changed, which it had, so the
# run read as a rule no probe covers. Both halves assert now.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()

a = "    const config = this.configs.get(offer.config_version);"
assert a in s, "offers.ts settle config anchor has drifted"
s = s.replace(a, """    let config = this.configs.get(offer.config_version);
    for (const c of this.configs.values()) {
      if (c.presenter === offer.presenter) config = c;
    }""", 1)

b = "        const amount = c.given_by ? 0 : c.unit_price * c.quantity;\n        kept += amount;"
assert b in s, "offers.ts kept pricing anchor has drifted"
s = s.replace(b, """        const amount = c.given_by ? 0 : (config!.products[c.product]?.price ?? c.unit_price) * c.quantity;
        kept += amount;""", 1)

p.write_text(s)
