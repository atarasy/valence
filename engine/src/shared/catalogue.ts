import type { PresenterConfig } from '../common/types.js';

export const CATALOGUE_SIGNATURE_FORMAT = 'valence.catalogue.2';
function fields(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('catalogue object required');
  const keys = Object.keys(value);
  if (required.some(k => !Object.hasOwn(value,k)) || keys.some(k => !required.includes(k) && !optional.includes(k))) throw new TypeError('unknown or missing catalogue field');
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value) throw new TypeError('catalogue text required');
  for (const point of value) { const n = point.codePointAt(0)!; if (n >= 0xD800 && n <= 0xDFFF) throw new TypeError('unpaired Unicode surrogate'); }
}
function integer(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('nonnegative safe integer required');
}
/** §5.4. Every declared publication field, with an explicit revision domain. */
export function canonicalConfig(config: PresenterConfig): Buffer {
  fields(config,['version','presenter','products']); text(config.version); text(config.presenter);
  if (!config.products || typeof config.products !== 'object' || Array.isArray(config.products)) throw new TypeError('products object required');
  const rows = Object.keys(config.products).sort().map(ref => {
    text(ref); const e = config.products[ref]!;
    fields(e,['merchant','maker','ships','price'],['category','physical']);
    text(e.merchant); text(e.maker); text(e.ships); integer(e.price);
    if (e.category !== undefined) text(e.category);
    let physical: [boolean,number,boolean,boolean] | null = null;
    if (e.physical !== undefined) {
      const p = e.physical; fields(p,['ambient','keeps_for_days','fits_ten_per_container','regulated']);
      integer(p.keeps_for_days);
      if ([p.ambient,p.fits_ten_per_container,p.regulated].some(v => typeof v !== 'boolean')) throw new TypeError('eligibility booleans required');
      physical = [p.ambient,p.keeps_for_days,p.fits_ten_per_container,p.regulated];
    }
    return [ref,e.merchant,e.maker,e.ships,e.price,e.category ?? null,physical];
  });
  return Buffer.from(JSON.stringify([CATALOGUE_SIGNATURE_FORMAT,config.version,config.presenter,rows]),'utf8');
}
