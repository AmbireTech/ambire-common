export function isSupportedSafeVersion(version: string): boolean {
  const [major, minor, patch] = version.split('.').map(Number)
  if ([major, minor, patch].some(Number.isNaN)) return false

  if (major && major > 1) return true
  if (major === 1 && minor && minor > 3) return true
  if (major === 1 && minor === 3 && patch && patch >= 0) return true

  return false
}
