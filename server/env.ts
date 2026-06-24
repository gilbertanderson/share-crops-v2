// Node env accessor. Returns undefined when unset.
export function getEnv(key: string): string | undefined {
  return process.env[key];
}
