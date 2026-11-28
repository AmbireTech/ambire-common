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

/**
 * The registry with the supported `$schema` declared on every descriptor that declares none, so
 * that test descriptors don't each have to. A descriptor's own `$schema` is kept
 */
export const declareSupportedSchema = (registry: Erc7730Registry): Erc7730Registry => ({
  ...registry,
  descriptors: Object.fromEntries(
    Object.entries(registry.descriptors).map(([path, descriptor]) => [
      path,
      descriptor && typeof descriptor === 'object'
        ? { $schema: '../../specs/erc7730-v2.schema.json', ...descriptor }
        : descriptor
    ])
  )
})
