import {
  Erc7730CalldataIndex,
  Erc7730Descriptor,
  Erc7730Eip712Index
} from '../../libs/humanizer/erc7730/types'
import lifiDiamondDescriptor from './descriptors/lifi-calldata-LIFIDiamond.json'
import upstreamFallbackCalldataIndex from './fallbackCalldataIndex.json'

// Ambire's own ERC-7730 descriptors and index entries, merged with the registry in `./index.ts`:
// descriptors for contracts the registry doesn't describe yet (or not on every network), and
// edits of registry descriptors. Unlike `./registry.json`, they are maintained by hand.

/**
 * Descriptors we ship ourselves live under this prefix instead of a
 * `registry/` path, so they never collide with an upstream file.
 */
export const INTERNAL_DESCRIPTOR_PATH_PREFIX = 'internal/'

const COW_SWAP_SETTLEMENT_ADDRESS = '0x9008d19f58aabd9ed0d60971565aa8510560ab41'
const COW_SWAP_EIP712_DESCRIPTOR_PATH = `${INTERNAL_DESCRIPTOR_PATH_PREFIX}cowswap/eip712-GPv2Settlement.json`
const COW_SWAP_CALLDATA_DESCRIPTOR_PATH = `${INTERNAL_DESCRIPTOR_PATH_PREFIX}cowswap/calldata-GPv2Settlement.json`
const COW_SWAP_ETH_FLOW_ADDRESS = '0xba3cb449bd2b4adddbc894d8697f5170800eadec'
const COW_SWAP_ETHEREUM_WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const COW_SWAP_ETH_FLOW_CALLDATA_DESCRIPTOR_PATH = `${INTERNAL_DESCRIPTOR_PATH_PREFIX}cowswap/calldata-CoWSwapEthFlow.json`
const COW_SWAP_ORDER_ENCODE_TYPE_HASH =
  '0xd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489'
const COW_SWAP_ORDER_CANCELLATIONS_ENCODE_TYPE_HASH =
  '0x4c89efb91ae246f78d2fe68b47db2fa1444a121a4f2dc3fda7a5a408c2e3588e'
const COW_SWAP_CHAIN_IDS = [1, 56, 100, 42161, 8453, 59144, 137, 43114, 9745, 57073, 11155111]
const COW_SWAP_ORDER_FORMAT =
  'Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,' +
  'uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,' +
  'string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)'
const COW_SWAP_ETH_FLOW_ORDER_FORMAT =
  'createOrder((address buyToken,address receiver,uint256 sellAmount,' +
  'uint256 buyAmount,bytes32 appData,uint256 feeAmount,uint32 validTo,' +
  'bool partiallyFillable,int64 quoteId) order)'
const COW_SWAP_ETH_FLOW_INVALIDATE_ORDER_FORMAT =
  'invalidateOrder((address buyToken,address receiver,uint256 sellAmount,' +
  'uint256 buyAmount,bytes32 appData,uint256 feeAmount,uint32 validTo,' +
  'bool partiallyFillable,int64 quoteId) order)'
const COW_SWAP_ETH_FLOW_INVALIDATE_ORDERS_FORMAT =
  'invalidateOrdersIgnoringNotAllowed((address buyToken,address receiver,' +
  'uint256 sellAmount,uint256 buyAmount,bytes32 appData,uint256 feeAmount,' +
  'uint32 validTo,bool partiallyFillable,int64 quoteId)[] orderArray)'

const COW_SWAP_METADATA = {
  owner: 'CoW Protocol',
  contractName: 'GPv2Settlement',
  info: {
    url: 'https://cow.fi/'
  }
}

const COW_SWAP_CALLDATA_INDEX: Erc7730CalldataIndex = Object.fromEntries(
  COW_SWAP_CHAIN_IDS.map((chainId) => [
    `eip155:${chainId}:${COW_SWAP_SETTLEMENT_ADDRESS}`,
    COW_SWAP_CALLDATA_DESCRIPTOR_PATH
  ])
)

const COW_SWAP_ETH_FLOW_CALLDATA_INDEX: Erc7730CalldataIndex = Object.fromEntries(
  COW_SWAP_CHAIN_IDS.map((chainId) => [
    `eip155:${chainId}:${COW_SWAP_ETH_FLOW_ADDRESS}`,
    COW_SWAP_ETH_FLOW_CALLDATA_DESCRIPTOR_PATH
  ])
)

/**
 * Typed messages of contracts the registry doesn't describe (CowSwap orders). Spread before the
 * registry's index, so its entry for the same contract replaces this one.
 */
export const FALLBACK_EIP712_INDEX: Erc7730Eip712Index = Object.fromEntries(
  COW_SWAP_CHAIN_IDS.map((chainId) => [
    `eip155:${chainId}:${COW_SWAP_SETTLEMENT_ADDRESS}`,
    {
      Order: [
        {
          path: COW_SWAP_EIP712_DESCRIPTOR_PATH,
          encodeTypeHashes: [COW_SWAP_ORDER_ENCODE_TYPE_HASH]
        }
      ],
      OrderCancellations: [
        {
          path: COW_SWAP_EIP712_DESCRIPTOR_PATH,
          encodeTypeHashes: [COW_SWAP_ORDER_CANCELLATIONS_ENCODE_TYPE_HASH]
        }
      ]
    }
  ])
)

/** The descriptors of the contracts the registry doesn't describe (CowSwap), by their path */
export const FALLBACK_DESCRIPTORS: Record<string, Erc7730Descriptor> = {
  [COW_SWAP_EIP712_DESCRIPTOR_PATH]: {
    $schema: 'https://eips.ethereum.org/assets/eip-7730/erc7730-v2.schema.json',
    context: {
      eip712: {
        domain: {
          name: 'Gnosis Protocol',
          version: 'v2',
          verifyingContract: COW_SWAP_SETTLEMENT_ADDRESS
        }
      }
    },
    metadata: COW_SWAP_METADATA,
    display: {
      formats: {
        [COW_SWAP_ORDER_FORMAT]: {
          intent: 'Place CowSwap order',
          fields: [
            {
              path: 'sellAmount',
              label: 'Sell amount',
              format: 'tokenAmount',
              params: { tokenPath: 'sellToken' },
              visible: 'always'
            },
            {
              path: 'buyAmount',
              label: 'Buy amount',
              format: 'tokenAmount',
              params: { tokenPath: 'buyToken' },
              visible: 'always'
            },
            {
              path: 'feeAmount',
              label: 'Fee',
              format: 'tokenAmount',
              params: { tokenPath: 'sellToken' },
              visible: { ifNotIn: ['0'] }
            },
            {
              path: 'receiver',
              label: 'To',
              format: 'addressName',
              visible: 'always'
            },
            {
              path: 'validTo',
              label: 'Valid until',
              format: 'date',
              params: { encoding: 'timestamp' },
              visible: 'always'
            },
            {
              path: 'kind',
              label: 'Order kind',
              format: 'raw',
              visible: 'always'
            },
            {
              path: 'partiallyFillable',
              label: 'Partially fillable',
              format: 'raw',
              visible: 'always'
            },
            {
              path: 'appData',
              label: 'App data',
              visible: 'never'
            },
            {
              path: 'sellTokenBalance',
              label: 'Sell token balance',
              visible: 'never'
            },
            {
              path: 'buyTokenBalance',
              label: 'Buy token balance',
              visible: 'never'
            }
          ]
        },
        'OrderCancellations(bytes[] orderUids)': {
          intent: 'Cancel CowSwap orders',
          fields: [
            {
              path: 'orderUids[]',
              label: 'Order',
              fields: [
                {
                  path: '.',
                  label: 'Order ID',
                  format: 'raw',
                  visible: 'always'
                },
                {
                  path: '.[32:52]',
                  label: 'Owner',
                  format: 'addressName',
                  visible: 'always'
                },
                {
                  path: '.[52:56]',
                  label: 'Valid until',
                  format: 'date',
                  params: { encoding: 'timestamp' },
                  visible: 'always'
                }
              ]
            }
          ]
        }
      }
    }
  },
  [COW_SWAP_ETH_FLOW_CALLDATA_DESCRIPTOR_PATH]: {
    $schema: 'https://eips.ethereum.org/assets/eip-7730/erc7730-v2.schema.json',
    metadata: {
      ...COW_SWAP_METADATA,
      contractName: 'CoWSwapEthFlow'
    },
    display: {
      formats: {
        [COW_SWAP_ETH_FLOW_ORDER_FORMAT]: {
          intent: 'Place CowSwap ETH order',
          fields: [
            {
              path: '@.value',
              label: 'Send',
              format: 'amount',
              visible: { ifNotIn: ['0'] }
            },
            {
              path: 'order.sellAmount',
              label: 'Sell amount',
              format: 'amount',
              visible: 'always'
            },
            {
              path: 'order.buyAmount',
              label: 'Buy amount',
              format: 'tokenAmount',
              params: { tokenPath: 'order.buyToken' },
              visible: 'always'
            },
            {
              path: 'order.feeAmount',
              label: 'Fee',
              format: 'amount',
              visible: { ifNotIn: ['0'] }
            },
            {
              path: 'order.receiver',
              label: 'To',
              format: 'addressName',
              visible: 'always'
            },
            {
              path: 'order.validTo',
              label: 'Valid until',
              format: 'date',
              params: { encoding: 'timestamp' },
              visible: 'always'
            },
            {
              path: 'order.partiallyFillable',
              label: 'Partially fillable',
              format: 'raw',
              visible: 'always'
            },
            {
              path: 'order.appData',
              label: 'App data',
              visible: 'never'
            },
            {
              path: 'order.quoteId',
              label: 'Quote ID',
              visible: 'never'
            }
          ]
        },
        [COW_SWAP_ETH_FLOW_INVALIDATE_ORDER_FORMAT]: {
          intent: 'Cancel CowSwap ETH order',
          fields: [
            {
              path: 'order.sellAmount',
              label: 'Sell amount',
              format: 'amount',
              visible: 'always'
            },
            {
              path: 'order.buyAmount',
              label: 'Buy amount',
              format: 'tokenAmount',
              params: { tokenPath: 'order.buyToken' },
              visible: 'always'
            },
            {
              path: 'order.receiver',
              label: 'To',
              format: 'addressName',
              visible: 'always'
            },
            {
              path: 'order.validTo',
              label: 'Valid until',
              format: 'date',
              params: { encoding: 'timestamp' },
              visible: 'always'
            },
            {
              path: 'order.appData',
              label: 'App data',
              visible: 'never'
            },
            {
              path: 'order.quoteId',
              label: 'Quote ID',
              visible: 'never'
            }
          ]
        },
        [COW_SWAP_ETH_FLOW_INVALIDATE_ORDERS_FORMAT]: {
          intent: 'Cancel CowSwap ETH orders',
          fields: [
            {
              path: 'orderArray[]',
              label: 'Order',
              fields: [
                {
                  path: 'sellAmount',
                  label: 'Sell amount',
                  format: 'amount',
                  visible: 'always'
                },
                {
                  path: 'buyAmount',
                  label: 'Buy amount',
                  format: 'tokenAmount',
                  params: { tokenPath: 'buyToken' },
                  visible: 'always'
                },
                {
                  path: 'receiver',
                  label: 'To',
                  format: 'addressName',
                  visible: 'always'
                },
                {
                  path: 'validTo',
                  label: 'Valid until',
                  format: 'date',
                  params: { encoding: 'timestamp' },
                  visible: 'always'
                },
                {
                  path: 'appData',
                  label: 'App data',
                  visible: 'never'
                },
                {
                  path: 'quoteId',
                  label: 'Quote ID',
                  visible: 'never'
                }
              ]
            }
          ]
        },
        'wrap(uint256 amount)': {
          intent: 'Wrap ETH',
          fields: [
            {
              path: 'amount',
              label: 'Amount',
              format: 'amount',
              visible: 'always'
            }
          ]
        },
        'unwrap(uint256 amount)': {
          intent: 'Unwrap WETH',
          fields: [
            {
              path: 'amount',
              label: 'Amount',
              format: 'tokenAmount',
              params: { token: COW_SWAP_ETHEREUM_WETH_ADDRESS },
              visible: 'always'
            }
          ]
        },
        'wrapAll()': {
          intent: 'Wrap all ETH',
          fields: []
        }
      }
    }
  },
  [COW_SWAP_CALLDATA_DESCRIPTOR_PATH]: {
    $schema: 'https://eips.ethereum.org/assets/eip-7730/erc7730-v2.schema.json',
    metadata: COW_SWAP_METADATA,
    display: {
      formats: {
        'setPreSignature(bytes orderUid,bool signed)': {
          intent: 'Pre-sign CowSwap order',
          fields: [
            {
              path: 'orderUid',
              label: 'Order ID',
              format: 'raw',
              visible: 'always'
            },
            {
              path: 'orderUid.[32:52]',
              label: 'Owner',
              format: 'addressName',
              visible: 'always'
            },
            {
              path: 'orderUid.[52:56]',
              label: 'Valid until',
              format: 'date',
              params: { encoding: 'timestamp' },
              visible: 'always'
            },
            {
              path: 'signed',
              label: 'Pre-signature enabled',
              format: 'raw',
              visible: 'always'
            }
          ]
        },
        'invalidateOrder(bytes orderUid)': {
          intent: 'Cancel CowSwap order',
          fields: [
            {
              path: 'orderUid',
              label: 'Order ID',
              format: 'raw',
              visible: 'always'
            },
            {
              path: 'orderUid.[32:52]',
              label: 'Owner',
              format: 'addressName',
              visible: 'always'
            },
            {
              path: 'orderUid.[52:56]',
              label: 'Valid until',
              format: 'date',
              params: { encoding: 'timestamp' },
              visible: 'always'
            }
          ]
        },
        'freeFilledAmountStorage(bytes[] orderUids)': {
          intent: 'Clear CowSwap filled amount storage',
          fields: [
            {
              path: 'orderUids[]',
              label: 'Order',
              fields: [
                {
                  path: '.',
                  label: 'Order ID',
                  format: 'raw',
                  visible: 'always'
                },
                {
                  path: '.[32:52]',
                  label: 'Owner',
                  format: 'addressName',
                  visible: 'always'
                },
                {
                  path: '.[52:56]',
                  label: 'Valid until',
                  format: 'date',
                  params: { encoding: 'timestamp' },
                  visible: 'always'
                }
              ]
            }
          ]
        },
        'freePreSignatureStorage(bytes[] orderUids)': {
          intent: 'Clear CowSwap pre-signature storage',
          fields: [
            {
              path: 'orderUids[]',
              label: 'Order',
              fields: [
                {
                  path: '.',
                  label: 'Order ID',
                  format: 'raw',
                  visible: 'always'
                },
                {
                  path: '.[32:52]',
                  label: 'Owner',
                  format: 'addressName',
                  visible: 'always'
                },
                {
                  path: '.[52:56]',
                  label: 'Valid until',
                  format: 'date',
                  params: { encoding: 'timestamp' },
                  visible: 'always'
                }
              ]
            }
          ]
        }
      }
    }
  }
}

/**
 * Contracts the registry doesn't describe, or not on these networks (CowSwap, Safe 1.4.1). Spread
 * before the registry's index, so its entry for the same contract replaces this one.
 *
 * The entries that point at a registry descriptor rather than one of ours are in
 * `./fallbackCalldataIndex.json` - Safe 1.4.1 on Mantle, Unichain, Linea, Monad, Avalanche, World
 * Chain, Ink, HyperEVM, Robinhood, Celo, MegaETH, Scroll and Kaia - so that
 * `scripts/updateErc7730Registry.js` can read it and keep those descriptors in `./registry.json`
 * even if the registry's own index stops pointing at them.
 */
export const FALLBACK_CALLDATA_INDEX: Erc7730CalldataIndex = {
  ...COW_SWAP_CALLDATA_INDEX,
  ...COW_SWAP_ETH_FLOW_CALLDATA_INDEX,
  ...upstreamFallbackCalldataIndex
}

const LIFI_DIAMOND_DESCRIPTOR_PATH = `${INTERNAL_DESCRIPTOR_PATH_PREFIX}lifi/calldata-LIFIDiamond.json`

/**
 * Unlike FALLBACK_DESCRIPTORS, these replace a descriptor the upstream registry
 * already has, so OVERRIDE_CALLDATA_INDEX is spread last and wins the key.
 *
 * The LiFi one is registry/lifi/calldata-LIFIDiamond.json with one edit of our
 * own: the destination chain is an enum of chain names instead of a raw number.
 * Refreshing it from upstream means redoing that edit. Typed as `unknown`, like
 * the registry's own descriptors, as it is validated when it is used.
 */
export const OVERRIDE_DESCRIPTORS: Record<string, unknown> = {
  [LIFI_DIAMOND_DESCRIPTOR_PATH]: lifiDiamondDescriptor
}

export const OVERRIDE_CALLDATA_INDEX: Erc7730CalldataIndex = Object.fromEntries(
  lifiDiamondDescriptor.context.contract.deployments.map(({ chainId, address }) => [
    `eip155:${chainId}:${address.toLowerCase()}`,
    LIFI_DIAMOND_DESCRIPTOR_PATH
  ])
)

/** Every descriptor of Ambire's own, by its path */
export const AMBIRE_DESCRIPTORS: Record<string, unknown> = {
  ...FALLBACK_DESCRIPTORS,
  ...OVERRIDE_DESCRIPTORS
}
