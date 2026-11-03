import {
  ERC7730_CALLDATA_INDEX_RELAYER_PATH,
  ERC7730_EIP712_INDEX_RELAYER_PATH
} from '../../src/libs/humanizer/erc7730/consts'
import { BindedRelayerCall } from '../../src/libs/relayerCall/relayerCall'

/**
 * A relayer for the `Erc7730Controller` of tests that don't test ERC-7730 humanization.
 * It answers that there are no ERC-7730 descriptors, so the controller falls back to
 * the built-in humanization the way it does for a transaction without one.
 *
 * Use it instead of an unbound `relayerCall`, which fails every descriptor lookup and
 * makes the controller emit (and log) an error on every humanization.
 */
export const noErc7730DescriptorsRelayer: BindedRelayerCall = async (path: string) => {
  if (path === ERC7730_CALLDATA_INDEX_RELAYER_PATH || path === ERC7730_EIP712_INDEX_RELAYER_PATH) {
    return { success: true, data: {}, errorState: [] }
  }

  // With empty indexes there's no descriptor to fetch, so any other call is a mistake in the test
  throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
}
