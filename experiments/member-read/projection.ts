import schemas from './response-schemas.json';
// Deliberately limited to the fixed, locally authored schema constructs below.
// Unknown schema features stop startup; this is not a general JSON Schema implementation.
const keywords = new Set(['$schema','title','description','type','properties','required','additionalProperties','items','anyOf','enum','const','minimum','maximum','minLength','maxLength','minItems','maxItems','pattern']);
function inspect(s: any): void {
  for (const key of Object.keys(s)) if (!keywords.has(key)) throw new Error(`Unsupported pinned schema feature: ${key}`);
  for (const child of Object.values(s.properties ?? {})) inspect(child);
  if (s.items) inspect(s.items);
  for (const child of s.anyOf ?? []) inspect(child);
}
Object.values(schemas).forEach(inspect);
function matches(s: any, value: any): boolean {
  if (s.anyOf && !s.anyOf.some((child: any) => matches(child,value))) return false;
  if (s.enum && !s.enum.includes(value)) return false;
  if ('const' in s && value !== s.const) return false;
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t: string) => t === 'null' ? value === null : t === 'array' ? Array.isArray(value) : t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : t === 'integer' ? Number.isSafeInteger(value) : t === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === t)) return false;
  }
  if (typeof value === 'number' && ((s.minimum !== undefined && value < s.minimum) || (s.maximum !== undefined && value > s.maximum))) return false;
  if (typeof value === 'string' && ((s.minLength !== undefined && [...value].length < s.minLength) || (s.maxLength !== undefined && [...value].length > s.maxLength) || (s.pattern && !new RegExp(s.pattern).test(value)))) return false;
  if (Array.isArray(value) && ((s.minItems !== undefined && value.length < s.minItems) || (s.maxItems !== undefined && value.length > s.maxItems) || (s.items && !value.every(x => matches(s.items,x))))) return false;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if ((s.required ?? []).some((key: string) => !Object.hasOwn(value,key))) return false;
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(s.properties ?? {},key)) { if (!matches(s.properties[key],child)) return false; }
      else if (s.additionalProperties === false) return false;
    }
  }
  return true;
}
export function validProjection(kind: keyof typeof schemas, value: unknown): boolean { return matches(schemas[kind],value); }
