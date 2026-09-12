import { ValenceEngine } from "./engine/offers.js";
import { InMemoryLedger } from "./engine/ledger.js";
import { MeterLedger } from "./engine/meter-ledger.js";
import { createApp } from "./http.js";
import { rolesFrom } from "./common/roles.js";
import { inMemoryStore, openStore } from "./common/store.js";
import { RemoteMandates } from "./engine/mandate-source.js";
import { RemoteDay } from "./engine/day-source.js";
import { LocalDeliveries, RemoteDeliveries } from "./engine/delivery-source.js";
import { RecoveryRegister } from "./hub/node.js";
import { ApprovalDesk } from "./hub/approval.js";
import { PermissionLedger } from "./hub/permissions.js";
import { DeliveryRegister } from "./hub/delivery.js";
import { Registry } from "./shared/registry.js";

const rate = Number(process.env.VALENCE_EXPLORATION_RATE);
if (!(rate > 0)) {
  console.error(
    "VALENCE_EXPLORATION_RATE must be set and greater than zero.\n" +
      "The specification publishes no recommended figure (SPEC §14); a default here\n" +
      "would become one by accident."
  );
  process.exit(1);
}

// §14b. The same absence as the rate above, and for the same reason: the days
// before uncollected goods are lost depend on the route and the goods, and a
// figure here would become the recommended one by being run. It defaulted to
// three until 2026-09-11, which made §14b's own sentence false.
// Read as a string first. `Number("")` is 0 and so is `Number(undefined ?? "")`,
// so a check that converts before it looks accepts both an unset variable and
// an empty one, and starts with a three-day grace turned silently into none.
// Measured 2026-09-11: the first version of this refusal did exactly that.
const graceRaw = process.env.VALENCE_RECOVERY_GRACE_DAYS;
const grace = Number(graceRaw);
if (graceRaw === undefined || graceRaw.trim() === "" || !Number.isInteger(grace) || grace < 0) {
  console.error(
    "VALENCE_RECOVERY_GRACE_DAYS must be an integer of at least zero.\n" +
      "The specification publishes no recommended figure (SPEC §14b); a default here\n" +
      "would become one by accident."
  );
  process.exit(1);
}

// §10.5, §14b. The name a member's device signs for. An engine that cannot
// place an assertion cannot check one, and the specification requires every
// implementation to accept assertions, so this has no default either.
const relyingPartyId = process.env.VALENCE_RP_ID ?? "";
if (relyingPartyId.trim() === "") {
  console.error(
    "VALENCE_RP_ID must be the hostname a member's device signs for, which is the\n" +
      "hub's own (SPEC §10.5, §14b). Without it this engine cannot tell whom an\n" +
      "assertion was made for."
  );
  process.exit(1);
}

/**
 * The ledger. In memory unless Meter is configured, because the conformance
 * suites need a subject that runs anywhere and a real ledger needs a database.
 *
 * Either way the reserve ceiling of §6.4 is enforced in the adapter. It is not
 * a property of the ledger underneath, and Meter in particular does not
 * provide it.
 */
const ledger = process.env.METER_BASE_URL
  ? new MeterLedger({
      baseUrl: process.env.METER_BASE_URL,
      serviceId: process.env.METER_SERVICE_ID ?? "",
      apiKey: process.env.METER_API_KEY ?? "",
      tool: process.env.METER_TOOL ?? "valence.offer",
      provider: process.env.METER_PROVIDER ?? "valence",
    })
  : new InMemoryLedger();

/**
 * §13.2. Where this process keeps what it holds. Unset is in memory, which is
 * what the conformance suites run against and what the reference has always
 * done; a deployment that wants a restart not to be a loss says where.
 *
 * A role-split pair keeps two databases, one each, which is the point: the
 * person's side holds what is the person's.
 */
const store = process.env.VALENCE_DB ? openStore(process.env.VALENCE_DB) : inMemoryStore();

// Clause 46. The registry is what "in the network" means, so it is built
// before the engine and handed in: a person's ceiling on the rest is theirs,
// and the engine needs to know which merchants the rest are.
const registry = new Registry(store);

const engine = new ValenceEngine(ledger, {
  explorationRate: rate,
  reminderLimit: 1,
  recoveryGraceDays: grace,
  relyingPartyId,
  isInNetwork: (merchant) => {
    try {
      registry.resolve(merchant);
      return true;
    } catch {
      return false;
    }
  },
}, store);

const hub = {
  recovery: new RecoveryRegister(store),
  approvals: new ApprovalDesk(store),
  permissions: new PermissionLedger(store),
  deliveries: new DeliveryRegister(store),
  registry,
};

const port = Number(process.env.PORT ?? 8787);
// §13.1. VALENCE_ROLES names the surfaces this process presents. Unset is
// both, which is what the reference runs and what the conformance suites reach
// unless they are pointed at a single role on purpose.
const roles = rolesFrom(process.env.VALENCE_ROLES);

// §13.1. An engine that does not present the hub has no register to read, and
// asks the hub over the endpoints the specification already defines. Pointing
// a deployment that runs both roles at a remote hub is allowed and pointless;
// leaving it unset when the hub is absent is the mistake worth catching, and
// it is caught here rather than at the first offer.
// §7.5b, §13.1. The carriage on the approval and on the statement comes from
// the hub's register. A process that presents the hub reads its own; one that
// does not asks the hub over the route the specification already gives it.
engine.readDeliveriesFrom(new LocalDeliveries(hub.deliveries));
if (process.env.VALENCE_HUB_URL) {
  engine.readMandatesFrom(new RemoteMandates(process.env.VALENCE_HUB_URL));
  engine.readTheDayFrom(new RemoteDay(process.env.VALENCE_HUB_URL));
  if (!roles.has("hub")) {
    engine.readDeliveriesFrom(new RemoteDeliveries(process.env.VALENCE_HUB_URL));
  }
} else if (!roles.has("hub")) {
  console.error(
    "VALENCE_ROLES presents the engine without the hub, so this process holds no\n" +
      "mandates. Set VALENCE_HUB_URL to the hub that does (SPEC §13.1)."
  );
  process.exit(1);
}
Bun.serve({ port, fetch: createApp(engine, hub, roles) });
console.log(`valence-engine listening on http://localhost:${port}`);
