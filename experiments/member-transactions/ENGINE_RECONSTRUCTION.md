# Persistent engine reconstruction

SPEC Appendix B requires fresh engines to rebuild candidate lookup from stored offers. Constructor loading refuses conflicting candidates or a stored key different from the offer ID. Creation/import checks candidate uniqueness before storing the new offer; imported duplicate IDs cannot change the owner selected by note lookup.

Bare receipt records have independent random references, so they are not reconstructible from edges. The `bare_receipts` store map persists exact household reference/time rows. Receipt reads and imports clone nested rows to prevent caller mutations from changing engine state. Importing an edge alone does not generate a receipt. A legacy store without receipt rows retains an explicit history gap; migration must recover an export or acknowledge the missing history rather than mint replacement references.

The unified transaction rolls back edge, bare receipt and identity writes together on failure. Ordinary `openStore` supports persistence after reopen but does not gain a multi-record transaction from this change. No HTTP route or native client was enabled. Tests use actual engine methods with fixture signatures, database fault injection and fresh runtimes. They are not a new process-kill or native-device measurement.

The existing `receipt_names_its_product` mutation in this isolated checkout now targets the cloned return expression. Its behaviour is unchanged: it adds a product to a bare receipt. An isolated run of the existing mutation fails the explicit receipt-shape test. Shared sweep inputs are untouched; the complete mutation corpus was not executed behaviourally.

## Writer adoption inventory and next implementation

This is a source inventory, not a completed adoption audit. `engine/src/server.ts` constructs one long-lived engine and hub over `openStore`; its remote-source configuration must stay separate from the local-only member composition. Introduce an isolated transaction-backed local composition first. Do not replace a live server or migrate files in place.

| Surface | Current owner | Required treatment |
|---|---|---|
| Catalogue and identity/disclosure changes | `engine/src/http.ts`, configuration/register/disclosure routes | Reconstruct registers within each unit; current review must observe changes |
| Offer creation, present, decisions, withdrawals, reminders, settlement | `engine/src/http.ts`, offer routes | One unit per operation with fresh engine and local sources |
| Offer reads, statement rendering, lists and export | `engine.mustGet`, `offersForHousehold`, `sweep`; HTTP and node exports | Include expiry writes in the boundary; a GET label is not evidence of read-only behaviour |
| Physical collection and delivery | Recovery ledger, `applyRecoveryTo`, delivery register | Collection, resulting offer state and delivery changes must use the same store lock |
| Approvals, permissions, duplicate-query records | Approval desk and permission ledger | Include signatures, query audit and approval effects; inventory every direct register writer |
| Lineage and notes | Engine `acceptEdge`, `addNote` | Edge plus bare receipt atomic; note lookup reconstructed |
| Household day and mandates | Household ledger and mandate register | Local day/mandate writers must participate before member ceiling/authority guarantees apply |
| Registry attestation/registration | Registry in server hub | Reconstruct with the unit; network-membership policy must read that same view |
| Node import | HTTP import sequence across offers, settlements, notes, edges, receipts, collections, confirmations and permissions | Validate the full staged input and import once atomically; partial imports must not become visible |
| Member access and passkeys | `member-read/authority`, `member-login`, bindings and journal | Shared constructors exist; keep provisioning, revocation, login and transaction paths on the same database capability |
| Existing-file cutover | No adoption implementation yet | Compare namespaces/scope, detect conflicts and missing receipt history, dry-run to a new file, verify exports, then select the new file explicitly |

Before migration, test the new composition through its real request boundary, including concurrent requests, revocation order, expiry-on-read, import rollback and rejected remote configurations. Then rehearse migration using isolated fixture copies. Native Swift write integration remains after these gates; Android remains a later phase.
