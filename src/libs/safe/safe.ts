export function isSupportedSafeVersion(version: string): boolean {
  const [major, minor] = version.split('.').map(Number)
  if ([major, minor].some(Number.isNaN)) return false

  if (major && major > 1) return true
  if (major === 1 && minor && minor >= 3) return true

  return false
}
