# Protected member refresh

Member offer discovery remains an authenticated foreground read of every presenter configured in the current session. A push never contains a household, presenter, offer, product, state or count and never reports a member read to a presenter. It is only an APNs background wake with `aps.content-available = 1` and the closed custom object `{ "profile": "atarasy.member-refresh-hint.1" }`.

An authenticated device registers its APNs token and sandbox/production environment at `/member/refresh/subscription`. The response deliberately does not echo the token. The trusted worker compares the complete authorised offer projections for the credential's current presenter grants with the last acknowledged fingerprint. A change creates one durable delivery ID. Failed provider delivery keeps that ID for an exact retry; acknowledgement advances the fingerprint. Revoked credentials are disabled before another delivery.

The provider can observe a device token and the time a generic wake is sent, and the member host necessarily knows which household and credential own the subscription. The provider cannot distinguish the affected presenter, offer, product or action from the payload. Batching and provider retention remain deployment policy. This boundary does not claim to hide network access from the member host or APNs.

The native app validates the closed hint, marks displayed sources stale and clears private detail/review state. It does not fetch or decrypt offers in the notification callback. The next foreground access performs the existing bounded, authenticated per-presenter reads. Partial and denied results remain distinct from an empty inbox.

No APNs credentials or deployed provider are included in the repository. The trusted `deliverRefreshHints` adapter is intentionally absent from public HTTP, just as recovery notice delivery is. Physical-device background-delivery acceptance remains a release gate.
