import pathlib

# §10a.5. The approval surface shows every candidate at a quantity of one,
# whatever the offer holds. The block a merchant signed is standing text and
# carries no quantity, so the screen is the only place a person sees how much
# of a thing they are about to buy; a screen that shows the wrong quantity has
# shown the merchant's terms and not this sale.
#
# The probe has to create a candidate with a quantity above one for this to be
# a break at all: on an offer whose every quantity is one it changes nothing.

p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
a = "        quantity: c.quantity,"
assert a in s, "approval.ts quantity anchor has drifted"
s = s.replace(a, "        quantity: 1,", 1)
p.write_text(s)
