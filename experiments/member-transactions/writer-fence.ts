export type Fence = { profile: 'atarasy.local-writer-fence.1'; base: string; ticket: string; source: string; target: string; runtime: string; digest: string; phase: 'frozen' | 'retired' };
export function decodeFence(value: string, base: string): Fence {
  const f = JSON.parse(value) as Fence;
  if (!f || Object.keys(f).sort().join(',') !== 'base,digest,phase,profile,runtime,source,target,ticket' || f.profile !== 'atarasy.local-writer-fence.1' || f.base !== base || !['frozen','retired'].includes(f.phase) || !/^[a-f0-9-]{36}$/.test(f.ticket) || !/^[a-f0-9]{64}$/.test(f.runtime) || !/^[a-f0-9]{64}$/.test(f.digest) || typeof f.source !== 'string' || !f.source.startsWith('/') || typeof f.target !== 'string' || !f.target.startsWith('/') || f.target === f.source) throw new Error('Invalid writer fence');
  return f;
}
