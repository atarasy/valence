import { ValenceEngine } from "./engine/offers.js";
import { InMemoryLedger } from "./engine/ledger.js";
import { MeterLedger } from "./engine/meter-ledger.js";
import { createApp } from "./http.js";
import { rolesFrom } from "./common/roles.js";
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

// Clause 46. The registry is what "in the network" means, so it is built
// before the engine and handed in: a person's ceiling on the rest is theirs,
// and the engine needs to know which merchants the rest are.
const registry = new Registry();

const engine = new ValenceEngine(ledger, {
  explorationRate: rate,
  reminderLimit: 1,
  recoveryGraceDays: Number(process.env.VALENCE_RECOVERY_GRACE_DAYS ?? 3),
  isInNetwork: (merchant) => {
    try {
      registry.resolve(merchant);
      return true;
    } catch {
      return false;
    }
  },
});

const hub = {
  recovery: new RecoveryRegister(),
  approvals: new ApprovalDesk(),
  permissions: new PermissionLedger(),
  deliveries: new DeliveryRegister(),
  registry,
};

const port = Number(process.env.PORT ?? 8787);
// §13.1. VALENCE_ROLES names the surfaces this process presents. Unset is
// both, which is what the reference runs and what the conformance suites reach
// unless they are pointed at a single role on purpose.
const roles = rolesFrom(process.env.VALENCE_ROLES);
Bun.serve({ port, fetch: createApp(engine, hub, roles) });
console.log(`valence-engine listening on http://localhost:${port}`);
