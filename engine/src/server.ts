import { ValenceEngine } from "./engine.js";
import { InMemoryLedger } from "./ledger.js";
import { MeterLedger } from "./meter-ledger.js";
import { createApp } from "./http.js";

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

const engine = new ValenceEngine(ledger, {
  explorationRate: rate,
  explorationThreshold: Number(process.env.VALENCE_EXPLORATION_THRESHOLD ?? 0.2),
  reminderLimit: 1,
});

const port = Number(process.env.PORT ?? 8787);
Bun.serve({ port, fetch: createApp(engine) });
console.log(`valence-engine listening on http://localhost:${port}`);
