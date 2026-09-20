import { expect, test } from 'bun:test';
import fixtures from './reference-fixtures.json';
import { validProjection } from './projection.ts';

// Question 48, 2026-09-15. Requiring `collected_as` in these copies refused
// every offer, list and approval read on the development API with 503. The
// field is admitted, constrained, and not required.
test('an offer, list or approval candidate may carry collected_as, and only a collection verdict or null', () => {
  const offer = structuredClone(fixtures['digital-offer']) as any;
  const approval = structuredClone(fixtures['digital-approval']) as any;
  const list = structuredClone(fixtures['house-a-list']) as any;
  expect(validProjection('offer', offer)).toBe(true);
  for (const value of ['returned', 'consumed', 'missing', null]) {
    offer.candidates[0].collected_as = value; approval.candidates[0].collected_as = value; list.offers[0].candidates[0].collected_as = value;
    expect([validProjection('offer', offer), validProjection('approval', approval), validProjection('list', list)]).toEqual([true, true, true]);
  }
  offer.candidates[0].collected_as = 'lost'; approval.candidates[0].collected_as = 'lost'; list.offers[0].candidates[0].collected_as = 'lost';
  expect([validProjection('offer', offer), validProjection('approval', approval), validProjection('list', list)]).toEqual([false, false, false]);
});

// A signed take-back needs the exact decision time. Keep old responses
// readable, while rejecting a malformed value instead of passing it to a signer.
test('offer and list admit a decision time and reject malformed signing input', () => {
  const offer = structuredClone(fixtures['digital-offer']) as any;
  const list = structuredClone(fixtures['house-a-list']) as any;
  for (const value of [null, 0, 1720000000000]) {
    offer.decided_at = value; list.offers[0].decided_at = value;
    expect([validProjection('offer', offer), validProjection('list', list)]).toEqual([true, true]);
  }
  for (const value of [-1, 0.5, '1720000000000', Number.MAX_SAFE_INTEGER + 1]) {
    offer.decided_at = value; list.offers[0].decided_at = value;
    expect([validProjection('offer', offer), validProjection('list', list)]).toEqual([false, false]);
  }
});
