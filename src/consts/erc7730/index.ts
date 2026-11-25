import { Erc7730Registry } from '../../libs/humanizer/erc7730/types'
import registry from './registry.json'

/**
 * The ERC-7730 ("clear signing") registry the wallet ships with: the registry of
 * https://github.com/ethereum/clear-signing-erc7730-registry with Ambire's changes and own
 * descriptors applied (see `scripts/erc7730/amendments.ts`), built into `./registry.json` by
 * `npm run humanizer:update:erc7730Registry`. Descriptors are read only from here, never fetched.
 *
 * Import it only where descriptors are looked up (`Erc7730Controller`), so the few MB of
 * descriptors don't end up in the UI bundle.
 */
export const BUNDLED_ERC7730_REGISTRY: Erc7730Registry = {
  calldataIndex: registry.calldataIndex,
  eip712Index: registry.eip712Index,
  descriptors: registry.descriptors
}
