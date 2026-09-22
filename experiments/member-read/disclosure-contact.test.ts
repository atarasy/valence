import { expect, test } from 'bun:test';
import fixtures from './reference-fixtures.json';
import { validProjection } from './projection.ts';

// Question 72, 2026-09-22. The engine now carries a merchant's signed contact
// on every disclosure it returns. A block from an older engine has none, so
// the key is admitted, constrained, and not required, for question 48's
// reason: requiring it would answer 503 to every read from such a host.
test('a disclosure may carry a contact, and only a kind and a value or null', () => {
  const offer = structuredClone(fixtures['digital-offer']) as any;
  const approval = structuredClone(fixtures['digital-approval']) as any;
  expect(offer.disclosures.length).toBeGreaterThan(0);
  expect(approval.disclosures.length).toBeGreaterThan(0);
  for (const contact of [null, { kind: 'email', value: 'help@shop.example' }, { kind: 'tel', value: '+81 3-0000-0000' }, { kind: 'url', value: 'https://shop.example/help' }]) {
    offer.disclosures[0].contact = contact; approval.disclosures[0].contact = contact;
    expect(validProjection('offer', offer)).toBe(true);
    expect(validProjection('approval', approval)).toBe(true);
  }
  for (const contact of [{ kind: 'sms', value: 'x' }, { kind: 'email' }, { kind: 'email', value: 'a@b', extra: 1 }, 'help@shop.example']) {
    offer.disclosures[0].contact = contact; approval.disclosures[0].contact = contact;
    expect(validProjection('offer', offer)).toBe(false);
    expect(validProjection('approval', approval)).toBe(false);
  }
});
