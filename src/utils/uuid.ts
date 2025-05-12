// FIXME: Temporary experiment
import { v4 as uuidv4 } from 'uuid'

/**
 * Dynamically import 'uuid' at runtime instead of static import. This avoids
 * random seed initialization during build time, ensuring that extension builds
 * are fully deterministic and identical across environments.
 */
export async function generateUuid(): Promise<string> {
  return uuidv4()
}
