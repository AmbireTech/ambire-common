/**
 * Dynamically import 'uuid' at runtime instead of static import. This avoids
 * random seed initialization during build time, ensuring that extension builds
 * are fully deterministic and identical across environments.
 */
export async function generateUuid(): Promise<string> {
  // TODO: Temporarily switch to nanoid
  const { nanoid } = await import('nanoid')
  return nanoid(36)
}
