# Digital quotation archives

`valence-node/9` carries `carriage_quotes` alongside owned offers. Each immutable row contains `offer`, `carriage` and `quoted_at`. Amounts and timestamps are nonnegative safe integers; unknown fields and duplicate identities are refused. The importer checks ownership through the carried digital offer before writing. An identical replay preserves the quotation. A changed quotation or an attempt to add one to an already carried offer is refused.

The existing money-movement boundary remains: unfinished offers stay at the source with their quotation and confirmation/protection records. Settled offers retain quotations, confirmations and fixed protections across the move. Old archive versions remain readable and have no quotation field when omitted. A composition without quotation storage refuses nonempty quotation data. PostgreSQL member HTTP and local archive rehearsal use their existing store's quotation register.

Engine tests exercise cross-host round-trip, exact retry, malformed/unscoped data, legacy re-import, unfinished-offer exclusion and rollback on a failed final quotation write. Strict archive tests check version compatibility and digital ownership. These tests use synthetic identities and no provider.

This is a household data archive, not an operational cutover. Deployment-bound member operation journals, incarnation heads, credentials and passkey counters are not transported by `NodeExport`. The earlier SQLite operational snapshot validator is a separate, older-schema mechanism; it still needs explicit quotation namespace and digital operation coverage before claiming a complete operational move. PostgreSQL deployment migration and native host switching remain outstanding.
