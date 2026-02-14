import { isWei, normalizeName } from 'wns-utils'
import type { WnsClient } from 'wns-utils'

export async function resolveWNSDomain({
  domain,
  wnsClient
}: {
  domain: string
  wnsClient: WnsClient
}): Promise<{ address: string }> {
  if (!isWei(domain)) return { address: '' }

  const normalized = normalizeName(domain)
  const address = await wnsClient.resolve(normalized)

  return { address: address || '' }
}

export async function reverseResolveWNS(
  address: string,
  wnsClient: WnsClient
): Promise<string | null> {
  const name = await wnsClient.reverseResolve(address)
  return name || null
}
