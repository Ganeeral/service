# Legal/content release checklist

Status on 2026-10-06: the user confirmed that the operator/legal form/country are not determined. Russian customer-facing [privacy](privacy-policy-draft.md) and [separate booking consent](booking-consent-draft.md) are editable drafts. They are not approval or a compliance determination. Internal project documentation stays English; public legal copy is Russian.

## Decisions and fields to fill

- Actual country/jurisdiction, entity type, full legal operator name, identifiers, address and contact for data requests.
- Actual domain, published contact information, approved consent identifier and dates.
- Each purpose, legal basis, recipient/processor and contract; including operator/owner messages through Telegram even for unlinked customers.
- Actual hosting/database/backup locations, Telegram recipients/countries/terms, localization and cross-border eligibility. Customer bot opt-in does not remove the owner's Telegram transfer.
- Approved retention periods for requests, completed records, consent/audit, message payloads, operational logs and backups; deletion/response procedure and person responsible.
- Offline consent collection/evidence for manual phone bookings. The current owner attestation is not itself customer consent evidence.
- Applicable regulator notices, internal policies, security/incident procedures and responsibility under the selected jurisdiction.

For the provisional Russia assumption, consult the current [official 152-FZ text](https://mintrud.gov.ru/docs/laws/130), especially articles 5, 9, 12, 18, 18.1, 21 and 22. The reviewed article 9 requires separate consent; articles 12/18 concern transfer/localization. This is why the drafts separate the documents and leave recipients, hosting and compliance decisions unresolved. The regulator's [operator portal](https://pd.rkn.gov.ru/operators-registry/notification/form/) and [cross-border portal](https://pd.rkn.gov.ru/cross-border-transmission/form2/) are follow-up references; these portal pages were unavailable to the browser during preparation, so submission requirements were not verified through their forms.

## Publication and technical alignment

1. Fill every placeholder, review against the actual business/infrastructure and have the responsible operator approve the resulting texts. If the country is different, rewrite the legal sections for that country first.
2. Save approved versioned copies and records of approval. Keep old consent text available for the versions stored in appointments.
3. Implement actual public policy and separate consent pages on the same canonical origin. Link both clearly; the booking checkbox links to the separate consent, not an unrelated generic policy. Draft files are not public pages. Do not use the development-only test notice.
4. Set `CONSENT_VERSION` and `CONSENT_NOTICE_URL` to the approved published consent. Confirm contact/data fields and recipient text match the implementation. The server records consent version/time; it does not archive documents automatically.
5. Configure verified hosting, owner access and production HTTPS. Verify actual logs exclude customer fields/tokens; configure edge abuse limits and retention cleanup. Current code clears processed webhook payloads but has no complete automatic deletion policy. Do not promise implemented cleanup before adding/verifying it.
6. Test with synthetic accounts: read both documents on mobile; submit with unchecked/checked consent; change the version and verify reset; check manual attestation, client linking, owner data visibility, privacy requests and backup/retention operations.
7. Only after these steps and the [owner launch checklist](../owner-inputs.md) explicitly enable `PUBLIC_BOOKING_ENABLED=true`. Telegram live setup is also deliberate; the implementation did not register a webhook, send to real users or deploy.

## Current technical facts for the reviewer

The form collects minimum vehicle/contact/task/window data, with an optional Telegram contact tag. Public slot lookup exposes no customer records. Browser draft/receipt/link state is held in component memory. A saved request creates pending state, an audit event and logical notification jobs transactionally. Private owner Telegram cards can contain customer name/phone/problem, while private notes stay owner-only. Client notification delivery requires an actual linked private chat. Durable message payloads and failed inbox inputs may contain personal data in PostgreSQL; retention and secure hosting must cover them. The remaining web dashboard will introduce its own secure session cookie, which needs inclusion in published technical-data disclosures when implemented.
