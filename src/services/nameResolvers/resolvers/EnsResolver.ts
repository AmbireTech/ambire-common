import {
  ENS_BASE_REGISTRAR,
  ENS_NAME_WRAPPER,
  ENS_NAME_WRAPPER_SEPOLIA,
  ENS_UNIVERSAL_RESOLVER,
  NameExpiry
} from '@/services/ensDomains'

import { EnsCompatibleResolver, ETHEREUM_CHAIN_ID } from './EnsCompatibleResolver'

// A wrapped ENS subname's expiry can be shortened at any time by the parent owner (setChildFuses),
// so it is re-polled on this TTL even far from the deadline, unlike a 2LD's registrar expiry.
export const ENS_SUBNAME_EXPIRY_TTL_IN_MS = 24 * 60 * 60 * 1000

const isEnsSubname = (name: string) => name.split('.').length > 2

/**
 * Ethereum Name Service. The fallback resolver: it owns `.eth` and any DNS name not claimed by a
 * more specific service, and is the only service with a registration expiry today.
 */
export class EnsResolver extends EnsCompatibleResolver {
  constructor() {
    super({
      id: 'ens',
      universalResolver: ENS_UNIVERSAL_RESOLVER,
      chainId: ETHEREUM_CHAIN_ID,
      isFallback: true,
      expiry: {
        baseRegistrar: ENS_BASE_REGISTRAR,
        nameWrapper: { mainnet: ENS_NAME_WRAPPER, testnet: ENS_NAME_WRAPPER_SEPOLIA }
      }
    })
  }

  matches(): boolean {
    // True because ENS resolves DNS names as well and acts as a fallback for any domain not claimed by a more specific service.
    return true
  }

  override shouldRefetchExpiry(name: string, cachedExpiry: NameExpiry | null | undefined): boolean {
    // Poll wrapped subnames on a TTL even far from the deadline; everything else follows the generic
    // staleness policy.
    if (
      isEnsSubname(name) &&
      cachedExpiry &&
      cachedExpiry.updatedAt + ENS_SUBNAME_EXPIRY_TTL_IN_MS < Date.now()
    ) {
      return true
    }

    return super.shouldRefetchExpiry(name, cachedExpiry)
  }
}
