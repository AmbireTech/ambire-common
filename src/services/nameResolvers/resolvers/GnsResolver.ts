import { EnsCompatibleResolver, ETHEREUM_CHAIN_ID } from './EnsCompatibleResolver'

// GNS universal resolver; same address on Ethereum mainnet and Sepolia. ENS-compatible.
const GNS_UNIVERSAL_RESOLVER = '0xD658131FFB6D732335d37f199374289F1b31564F'

/**
 * GNS names (.gwei) resolved on Ethereum. Ownerless, no registrar/NameWrapper, so no expiry.
 */
export class GnsResolver extends EnsCompatibleResolver {
  constructor() {
    super({
      id: 'gns',
      label: 'GNS',
      universalResolver: GNS_UNIVERSAL_RESOLVER,
      chainId: ETHEREUM_CHAIN_ID,
      featureFlag: 'gnsDomains'
    })
  }

  matches(domain: string): boolean {
    return domain.endsWith('.gwei')
  }
}
