/**
 * Dynamically import 'uuid' at runtime instead of static import. This avoids
 * random seed initialization during build time, ensuring that extension builds
 * are fully deterministic and identical across environments.
 */
export async function generateUuid(): Promise<string> {
  const { v4: uuidv4 } = await import('uuid')
  return uuidv4()
}
