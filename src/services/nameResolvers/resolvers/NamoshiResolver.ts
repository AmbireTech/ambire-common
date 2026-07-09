import { EnsCompatibleResolver } from './EnsCompatibleResolver'

// Namoshi universal resolver on Citrea; ENS-compatible, so it reuses the ENS resolution path.
const NAMOSHI_UNIVERSAL_RESOLVER = '0xc5Ed1fA34AD1F23F0cD2E36DB288290488B1B493'
const CITREA_CHAIN_ID = { mainnet: '4114', testnet: '5115' }

/**
 * Namoshi names (.btc, .citrea) resolved on Citrea. No ENS registrar/NameWrapper, so no expiry.
 */
export class NamoshiResolver extends EnsCompatibleResolver {
  constructor() {
    super({
      id: 'namoshi',
      universalResolver: NAMOSHI_UNIVERSAL_RESOLVER,
      chainId: CITREA_CHAIN_ID,
      featureFlag: 'namoshiDomains'
    })
  }

  matches(domain: string): boolean {
    return domain.endsWith('.btc') || domain.endsWith('.citrea')
  }
}
