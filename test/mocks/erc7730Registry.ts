import { Erc7730Registry } from '../../src/libs/humanizer/erc7730/types'

/**
 * A registry for the `Erc7730Controller` of tests that don't test ERC-7730 humanization. It has
 * no descriptors, so the controller falls back to the built-in humanization the way it does for a
 * transaction without one.
 *
 * Use it instead of the bundled registry, whose descriptors would change the humanization of any
 * real contract the test calls - and with it the test - whenever the registry is refreshed.
 */
export const EMPTY_ERC7730_REGISTRY: Erc7730Registry = {
  calldataIndex: {},
  eip712Index: {},
  descriptors: {}
}
