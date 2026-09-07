import { ValenceEngine } from "./engine.js";
import { InMemoryLedger } from "./ledger.js";
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

const engine = new ValenceEngine(new InMemoryLedger(), {
  explorationRate: rate,
  explorationThreshold: Number(process.env.VALENCE_EXPLORATION_THRESHOLD ?? 0.2),
  reminderLimit: 1,
});

const port = Number(process.env.PORT ?? 8787);
Bun.serve({ port, fetch: createApp(engine) });
console.log(`valence-engine listening on http://localhost:${port}`);
