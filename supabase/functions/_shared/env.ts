// Cross-runtime env accessor: works on Deno (Supabase Edge Functions) and
// Node (Vercel Serverless Functions). Returns undefined when unset.
export function getEnv(key: string): string | undefined {
  const g = globalThis as any;
  if (g.Deno?.env?.get) return g.Deno.env.get(key);
  if (g.process?.env) return g.process.env[key];
  return undefined;
}
