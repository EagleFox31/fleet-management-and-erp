export const TEST_PREFIX = "TEST-";

export function uniqueTestToken(label: string): string {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${TEST_PREFIX}${label}-${stamp}`;
}
