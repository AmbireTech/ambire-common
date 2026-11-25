import { Erc7730DisplayFormat } from '../../src/libs/humanizer/erc7730/types'
import { getRegistryKey } from '../../src/libs/humanizer/erc7730/utils'
import { Amendments } from './amend'
import cowSwapEthFlowFormats from './amendments/cowSwapEthFlow.json'
import lifi from './amendments/lifi.json'

// Ambire's changes to the ERC-7730 registry, applied by `npm run humanizer:update:erc7730Registry`
// (see `./amend.ts` for what each kind of change checks). Ambire's own descriptors are the JSON
// files in `./descriptors`, named by their path there - laid out like the upstream registry
// (`registry/<project>/...`), so that a file upstream adds at the same path fails the build - and
// indexed by their `deployments`.

// Formats read from the JSON files of `./amendments`. TypeScript reads their `visible` rules as
// any string; `applyAmendments` checks each descriptor once they are added to it
const LIFI_LEGACY_FORMATS = lifi.legacyFormats as Record<string, Erc7730DisplayFormat>
const COW_SWAP_ETH_FLOW_FORMATS = cowSwapEthFlowFormats as Record<string, Erc7730DisplayFormat>

/** Every key of a contract deployed at the same address on these networks */
const keysOn = (chainIds: number[], address: string) =>
  chainIds.map((chainId) => getRegistryKey(chainId, address))

const LIFI_DIAMOND_NAME = 'registry/lifi/calldata-LIFIDiamond.json'
const LIFI_DIAMOND_ADDRESS = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'
/** The LiFi Diamond as the registry lists it, with the address of each network */
const LIFI_DIAMOND_KEYS = [
  ...keysOn(
    [
      1, 10, 25, 30, 56, 100, 122, 137, 146, 196, 252, 480, 1135, 1329, 1625, 5000, 8453, 13371,
      34443, 42161, 42220, 43114, 534352
    ],
    LIFI_DIAMOND_ADDRESS
  ),
  ...keysOn(
    [143, 747, 988, 4326, 9745, 43111, 5734951],
    '0x026f252016a7c47cdef1f05a3fc9e20c92a49c37'
  ),
  ...keysOn([14, 88, 1480], '0x198fc70dfe05e755c81e54bd67bff3f729344b9b'),
  ...keysOn([130, 1868, 57073], '0x864b314d4c5a0399368609581d3e8933a63b9232'),
  ...keysOn([1672, 42170], '0xff70f4a1d11995621854f3692acf286d8acd04b2'),
  ...keysOn([50], '0x055d4612ec74ad799c6cb4df72c0ab8dbdbcbafa'),
  ...keysOn([999], '0x0a0758d937d1059c356d4714e57f5df0239bce1a'),
  ...keysOn([8217], '0x1255d17c1bc2f764d087536410879f2d0d8772fd'),
  ...keysOn([16661], '0x213a83c67e1fc0334ef684571abcb820708a6536'),
  ...keysOn([1088], '0x24ca98fb6972f5ee05f0db00595c7f68d9fafd68'),
  ...keysOn([33139], '0x2dea447e7dc6cd2f10b31bf10dcb30f87e838417'),
  ...keysOn([2020], '0x452cf1b8597e6319cd21abd847312bf17e26d8d1'),
  ...keysOn([98866], '0x6f5c8bb0c5fe4eceac40ee1c238eab6bbb29761c'),
  ...keysOn([42793], '0x977474593c982cfa8b197cae302e6d01f789435b'),
  ...keysOn([5042], '0xa4072583658fae592a3506a42431cb6316a8d40b'),
  ...keysOn([40], '0xa7cd44521903c65915648385e3fe881e49171582'),
  ...keysOn([4663], '0xb477751b76cf82d00a686a1232f5fcd772414af3'),
  ...keysOn([747474], '0xc59fe32c9549e3e8b5dccdabc45bd287bd5ba2bc'),
  ...keysOn([59144], '0xde1e598b81620773454588b85d6b5d4eec32573e'),
  ...keysOn([1776], '0xecec3970ca674278da8d9b1c484acaf6b20181f5'),
  ...keysOn([2818], '0xf7ab42d00d2399f8a4fba2f15466be40709fe307'),
  ...keysOn([80094], '0xf909c4ae16622898b885b89d7f839e0244851c66')
]
/** Networks of the LiFi Diamond the registry doesn't list, by the address it has there */
const LIFI_DIAMOND_EXTRA_KEYS = [
  getRegistryKey(204, '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'),
  getRegistryKey(232, '0xf3b20515d9b193531c48e47c18af16d1e5d28f9a'),
  getRegistryKey(288, '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'),
  getRegistryKey(324, '0x341e94069f53234fe6dabef707ad424830525715'),
  getRegistryKey(1284, '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'),
  getRegistryKey(2741, '0x4f8c9056bb8a3616693a76922fa35d53c056e5b3'),
  getRegistryKey(4217, '0x2cacae8e22418e65dcf7651c67aebe6288eb8243'),
  getRegistryKey(5031, '0x0bc413cae89c5b3ba3aa87fb98dca23425e1828f'),
  getRegistryKey(6900, '0x926c22dc753e543cf9cab75ceeb46ecf865d006a'),
  getRegistryKey(60808, '0x452cf1b8597e6319cd21abd847312bf17e26d8d1'),
  getRegistryKey(81457, '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae')
]

const COW_SWAP_ETH_FLOW_NAME = 'registry/cow-protocol/calldata-CoWSwapEthFlow.json'
const COW_SWAP_ETH_FLOW_ADDRESS = '0xba3cb449bd2b4adddbc894d8697f5170800eadec'
/** Networks of CoW Swap besides Ethereum, where the registry has the EthFlow contract */
const COW_SWAP_OTHER_CHAIN_IDS = [56, 100, 137, 8453, 9745, 42161, 43114, 57073, 59144, 11155111]

/** Safe 1.4.1 on networks the registry doesn't list for it */
const SAFE_1_4_1_CHAIN_IDS = [
  130, 143, 480, 999, 4326, 4663, 5000, 8217, 42220, 43114, 57073, 59144, 534352
]
const SAFE_1_4_1_DESCRIPTORS: [address: string, name: string][] = [
  ['0x41675c099f32341bf84bfc5382af534df5c7461a', 'registry/safe/calldata-Safe-1.4.1.json'],
  [
    '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67',
    'registry/safe/calldata-SafeProxyFactory-1.4.1.json'
  ],
  ['0xbd89a1ce4dde368ffab0ec35506eece0b1ffdc54', 'registry/safe/calldata-SafeToL2Setup-1.4.1.json']
]

export const amendments: Amendments = {
  amendCalldataDescriptors: {
    [LIFI_DIAMOND_NAME]: {
      reason:
        'show the destination network by its name, and keep describing functions LiFi no longer uses, for older transactions',
      addresses: LIFI_DIAMOND_KEYS,
      amend: ({ descriptor, fields, expectMatches, expectEqual }) => {
        const metadata = descriptor.metadata ?? {}
        const enums = (metadata.enums ?? {}) as Record<string, unknown>
        expectEqual(
          'the destination network enum of the registry',
          enums.destinationChainId,
          undefined
        )

        const chainIdFields = fields((field) => !!field.path?.endsWith('destinationChainId'))
        expectMatches('destination network fields', chainIdFields, { min: 1 })
        expectEqual(
          'the format of every destination network field',
          [...new Set(chainIdFields.map(({ field }) => field.format))],
          ['raw']
        )
        descriptor.metadata = {
          ...metadata,
          enums: { ...enums, destinationChainId: lifi.chainNames }
        }
        chainIdFields.forEach(({ field }) => {
          field.format = 'enum'
          field.params = { $ref: '$.metadata.enums.destinationChainId' }
        })

        const formats = descriptor.display!.formats!
        Object.entries(LIFI_LEGACY_FORMATS).forEach(([signature, format]) => {
          expectEqual(`${signature} of the registry`, formats[signature], undefined)
          formats[signature] = format
        })
      }
    },
    [COW_SWAP_ETH_FLOW_NAME]: {
      reason:
        'show the unwrapped amount in the native token of each network, and describe cancelling many orders',
      addresses: [getRegistryKey(1, COW_SWAP_ETH_FLOW_ADDRESS)],
      amend: ({ descriptor, fields, expectMatches, expectEqual }) => {
        const [unwrapAmount] = expectMatches(
          'unwrap amount fields',
          fields((field, format) => format === 'unwrap(uint256 amount)' && field.path === 'amount'),
          1
        )
        expectEqual('the unwrap amount format', unwrapAmount!.field.format, 'tokenAmount')
        unwrapAmount!.field.label = 'Amount to Unwrap'
        unwrapAmount!.field.format = 'amount'
        delete unwrapAmount!.field.params

        const formats = descriptor.display!.formats!
        Object.entries(COW_SWAP_ETH_FLOW_FORMATS).forEach(([signature, format]) => {
          expectEqual(`${signature} of the registry`, formats[signature], undefined)
          formats[signature] = format
        })
      }
    }
  },
  addCalldataDescriptors: {
    ...Object.fromEntries(LIFI_DIAMOND_EXTRA_KEYS.map((key) => [key, LIFI_DIAMOND_NAME])),
    ...Object.fromEntries(
      keysOn(COW_SWAP_OTHER_CHAIN_IDS, COW_SWAP_ETH_FLOW_ADDRESS).map((key) => [
        key,
        COW_SWAP_ETH_FLOW_NAME
      ])
    ),
    ...Object.fromEntries(
      SAFE_1_4_1_DESCRIPTORS.flatMap(([address, name]) =>
        keysOn(SAFE_1_4_1_CHAIN_IDS, address).map((key) => [key, name])
      )
    )
  },
  amendEip712Descriptors: {},
  addEip712Descriptors: {}
}
