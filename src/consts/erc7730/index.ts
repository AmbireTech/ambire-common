import { Erc7730Registry } from '../../libs/humanizer/erc7730/types'
import {
  AMBIRE_DESCRIPTORS,
  FALLBACK_CALLDATA_INDEX,
  FALLBACK_EIP712_INDEX,
  OVERRIDE_CALLDATA_INDEX
} from './ambireDescriptors'
import upstreamRegistry from './registry.json'

/**
 * The ERC-7730 ("clear signing") registry the wallet ships with: the registry of
 * https://github.com/ethereum/clear-signing-erc7730-registry (`./registry.json`, refreshed every
 * week by `.github/workflows/update-erc7730-registry.yml`) merged with Ambire's own descriptors
 * (`./ambireDescriptors.ts`). Descriptors are read only from here, never fetched.
 *
 * Import it only where descriptors are looked up (`Erc7730Controller`), so the few MB of
 * descriptors don't end up in the UI bundle.
 */
export const BUNDLED_ERC7730_REGISTRY: Erc7730Registry = {
  // Ambire's fallbacks are spread first so the registry replaces them once it covers the
  // contract, its overrides are spread last so they always win the key
  calldataIndex: {
    ...FALLBACK_CALLDATA_INDEX,
    ...upstreamRegistry.calldataIndex,
    ...OVERRIDE_CALLDATA_INDEX
  },
  eip712Index: {
    ...FALLBACK_EIP712_INDEX,
    ...upstreamRegistry.eip712Index
  },
  descriptors: {
    ...upstreamRegistry.descriptors,
    ...AMBIRE_DESCRIPTORS
  }
}
