import pathlib
# §6.5, §7.5b. The statement never shows the carriage, though the hub holds a
# delivery record for the offer. 法11条1号 wants the price and the carriage on
# the screen where the application is made, and a screen missing an item it
# must carry is a rescission ground under 法15条の4.
p = pathlib.Path("src/hub/statement.ts"); s = p.read_text()
a = "    carriage: delivery ? delivery.carriage : null,"
assert a in s, "hub/statement.ts carriage anchor has drifted"
s = s.replace(a, "    carriage: null,", 1)
p.write_text(s)
