import type { PresenterConfig } from '../common/types.js';

export const CATALOGUE_SIGNATURE_FORMAT = 'valence.catalogue.2';
/**
 * D-1, decided 2026-09-23 (`80_App_UI_Refinement_Plan_2026-09-23.md` §3.2,
 * §5 row D-1). "Catalogue publication signature revision 3": the domain a
 * publication signs when any product entry carries a display `name` or
 * `variant`. A publication with neither stays on revision 2 unchanged, so
 * every existing publisher and signature keeps working.
 */
export const CATALOGUE_SIGNATURE_FORMAT_3 = 'valence.catalogue.3';
/** The longest a catalogue `name` may be, in Unicode code points (SPEC §3). */
export const CATALOGUE_NAME_MAX = 120;
/** The longest a catalogue `variant` may be, in Unicode code points (SPEC §3). */
export const CATALOGUE_VARIANT_MAX = 60;
function fields(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('catalogue object required');
  const keys = Object.keys(value);
  if (required.some(k => !Object.hasOwn(value,k)) || keys.some(k => !required.includes(k) && !optional.includes(k))) throw new TypeError('unknown or missing catalogue field');
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value) throw new TypeError('catalogue text required');
  for (const point of value) { const n = point.codePointAt(0)!; if (n >= 0xD800 && n <= 0xDFFF) throw new TypeError('unpaired Unicode surrogate'); }
}
/** `text()`, with a bound on the number of Unicode code points (not UTF-16 units: the `for...of` above already walks by code point). */
function textWithLimit(value: unknown, max: number): asserts value is string {
  text(value);
  let count = 0;
  for (const _ of value as string) { count++; if (count > max) throw new TypeError(`catalogue text exceeds ${max} code points`); }
}
function integer(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('nonnegative safe integer required');
}
/**
 * Whether any product entry in this publication carries a display `name` or
 * `variant`, which is what puts the publication into signature revision 3
 * instead of 2. Cheap and non-throwing by design: `canonicalConfig` below is
 * what validates, and this is called only once it has already succeeded, to
 * choose which domain it used.
 */
export function catalogueHasDisplayFields(config: PresenterConfig): boolean {
  if (!config.products || typeof config.products !== 'object') return false;
  return Object.values(config.products).some(
    (e) => e && typeof e === 'object' && ((e as any).name !== undefined || (e as any).variant !== undefined)
  );
}
/** §5.4. Every declared publication field, with an explicit revision domain. */
export function canonicalConfig(config: PresenterConfig): Buffer {
  fields(config,['version','presenter','products']); text(config.version); text(config.presenter);
  if (!config.products || typeof config.products !== 'object' || Array.isArray(config.products)) throw new TypeError('products object required');
  let revision3 = false;
  const rows = Object.keys(config.products).sort().map(ref => {
    text(ref); const e = config.products[ref]!;
    fields(e,['merchant','maker','ships','price'],['category','physical','name','variant']);
    text(e.merchant); text(e.maker); text(e.ships); integer(e.price);
    if (e.category !== undefined) text(e.category);
    let physical: [boolean,number,boolean,boolean] | null = null;
    if (e.physical !== undefined) {
      const p = e.physical; fields(p,['ambient','keeps_for_days','fits_ten_per_container','regulated']);
      integer(p.keeps_for_days);
      if ([p.ambient,p.fits_ten_per_container,p.regulated].some(v => typeof v !== 'boolean')) throw new TypeError('eligibility booleans required');
      physical = [p.ambient,p.keeps_for_days,p.fits_ten_per_container,p.regulated];
    }
    // D-1. Display text only, never presentation (clause 54): no markup, no
    // image. Absent name/variant fall back to null in both revisions; a
    // single named entry in a multi-product publication still puts every
    // row through the nine-element revision 3 shape, never a mix of the two.
    if (e.name !== undefined) { textWithLimit(e.name, CATALOGUE_NAME_MAX); revision3 = true; }
    if (e.variant !== undefined) { textWithLimit(e.variant, CATALOGUE_VARIANT_MAX); revision3 = true; }
    return { row2: [ref,e.merchant,e.maker,e.ships,e.price,e.category ?? null,physical] as unknown[], name: e.name ?? null, variant: e.variant ?? null };
  });
  if (!revision3) {
    return Buffer.from(JSON.stringify([CATALOGUE_SIGNATURE_FORMAT,config.version,config.presenter,rows.map(r => r.row2)]),'utf8');
  }
  const rows3 = rows.map(r => [...r.row2, r.name, r.variant]);
  return Buffer.from(JSON.stringify([CATALOGUE_SIGNATURE_FORMAT_3,config.version,config.presenter,rows3]),'utf8');
}
