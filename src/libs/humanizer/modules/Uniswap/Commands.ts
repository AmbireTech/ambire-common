// @NOTE<Yosif>: updated as the techincal reference has been updated
// the only difference comes in commands after 0x10 - some have been changed, some removed
// the ones changed used to be about NFT trading, now are for the v4 contract
export const COMMANDS = {
  FLAG_ALLOW_REVERT: '0x80',
  COMMAND_TYPE_MASK: '0x3f',
  V3_SWAP_EXACT_IN: '0x00',
  V3_SWAP_EXACT_OUT: '0x01',
  PERMIT2_TRANSFER_FROM: '0x02',
  // PERMIT2_PERMIT_BATCH: '0x03',
  SWEEP: '0x04',
  TRANSFER: '0x05',
  PAY_PORTION: '0x06',
  V2_SWAP_EXACT_IN: '0x08',
  V2_SWAP_EXACT_OUT: '0x09',
  PERMIT2_PERMIT: '0x0a',
  WRAP_ETH: '0x0b',
  UNWRAP_WETH: '0x0c',
  // PERMIT2_TRANSFER_FROM_BATCH: '0x0d',
  V4_SWAP: '0x10'
}

/**
 * ABI-like structure for each uniswap action
 * https://docs.uniswap.org/contracts/universal-router/technical-reference
 */
export const COMMANDS_DESCRIPTIONS = {
  V3_SWAP_EXACT_IN: {
    command: '0x00',
    inputsDetails: [
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'amountIn' },
      { type: 'uint256', name: 'amountOutMin' },
      { type: 'bytes', name: 'path' },
      { type: 'bool', name: 'payerIsUser' }
    ]
  },
  V3_SWAP_EXACT_OUT: {
    command: '0x01',
    inputsDetails: [
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'amountOut' },
      { type: 'uint256', name: 'amountInMax' },
      { type: 'bytes', name: 'path' },
      { type: 'bool', name: 'payerIsUser' }
    ]
  },
  PERMIT2_TRANSFER_FROM: {
    command: '0x02',
    inputsDetails: [
      { type: 'address', name: 'token' },
      { type: 'address', name: 'recipient' },
      { type: 'uint160', name: 'amount' }
    ]
  },
  // PERMIT2_PERMIT_BATCH
  SWEEP: {
    command: '0x04',
    inputsDetails: [
      { type: 'address', name: 'token' },
      { type: 'address', name: 'recipient' },
      { type: 'uint160', name: 'amountMin' }
    ]
  },
  TRANSFER: {
    command: '0x05',
    inputsDetails: [
      { type: 'address', name: 'token' },
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'value' }
    ]
  },
  PAY_PORTION: {
    command: '0x06',
    inputsDetails: [
      { type: 'address', name: 'token' },
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'bips' }
    ]
  },
  V2_SWAP_EXACT_IN: {
    command: '0x08',
    inputsDetails: [
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'amountIn' },
      { type: 'uint256', name: 'amountOutMin' },
      { type: 'address[]', name: 'path' },
      { type: 'bool', name: 'payerIsUser' }
    ]
  },
  V2_SWAP_EXACT_OUT: {
    command: '0x09',
    inputsDetails: [
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'amountOut' },
      { type: 'uint256', name: 'amountInMax' },
      { type: 'address[]', name: 'path' },
      { type: 'bool', name: 'payerIsUser' }
    ]
  },
  PERMIT2_PERMIT: {
    command: '0x0a',
    inputsDetails: [
      {
        name: 'permit',
        type: 'tuple(tuple(address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline)'
      },
      { name: 'signature', type: 'bytes' }
    ]
  },
  WRAP_ETH: {
    command: '0x0b',
    inputsDetails: [
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'amountMin' }
    ]
  },
  UNWRAP_WETH: {
    command: '0x0c',
    inputsDetails: [
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'amountMin' }
    ]
  },
  V4_SWAP: {
    command: '0x10',
    inputsDetails: [
      { type: 'bytes', name: 'actions' },
      { type: 'bytes[]', name: 'params' }
    ]
  }
}

// taken from https://github.com/Uniswap/sdks/blob/9cf6edb2df79338ae58f7ea7ca979c35a8a9bd56/sdks/v4-sdk/src/utils/v4Planner.ts#L82C1-L163C2
const POOL_KEY_STRUCT =
  '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)'

const PATH_KEY_STRUCT =
  '(address intermediateCurrency,uint256 fee,int24 tickSpacing,address hooks,bytes hookData)'

const SWAP_EXACT_IN_SINGLE_STRUCT = `(${POOL_KEY_STRUCT} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`

const SWAP_EXACT_IN_STRUCT = `(address currencyIn,${PATH_KEY_STRUCT}[] path,uint128 amountIn,uint128 amountOutMinimum)`

const SWAP_EXACT_OUT_SINGLE_STRUCT = `(${POOL_KEY_STRUCT} poolKey,bool zeroForOne,uint128 amountOut,uint128 amountInMaximum,bytes hookData)`
const SWAP_EXACT_OUT_STRUCT = `(address currencyOut,${PATH_KEY_STRUCT}[] path,uint128 amountOut,uint128 amountInMaximum)`

enum Subparser {
  V4SwapExactInSingle,
  V4SwapExactIn,
  V4SwapExactOutSingle,
  V4SwapExactOut,
  PoolKey
}

// taken from https://github.com/Uniswap/sdks/blob/9cf6edb2df79338ae58f7ea7ca979c35a8a9bd56/sdks/v4-sdk/src/utils/v4Planner.ts#L82C1-L163C2

export const V4_ACTION_CODES = {
  // pool actions
  // liquidity actions
  INCREASE_LIQUIDITY: '0x00',
  DECREASE_LIQUIDITY: '0x01',
  MINT_POSITION: '0x02',
  BURN_POSITION: '0x03',

  // for fee on transfer tokens
  // INCREASE_LIQUIDITY_FROM_DELTAS: "0x04",
  // MINT_POSITION_FROM_DELTAS: "0x05",

  // swapping
  SWAP_EXACT_IN_SINGLE: '0x06',
  SWAP_EXACT_IN: '0x07',
  SWAP_EXACT_OUT_SINGLE: '0x08',
  SWAP_EXACT_OUT: '0x09',

  // closing deltas on the pool manager
  // settling
  SETTLE: '0x0b',
  SETTLE_ALL: '0x0c',
  SETTLE_PAIR: '0x0d',
  // taking
  TAKE: '0x0e',
  TAKE_ALL: '0x0f',
  TAKE_PORTION: '0x10',
  TAKE_PAIR: '0x11',

  CLOSE_CURRENCY: '0x12',
  // CLEAR_OR_TAKE: "0x13",
  SWEEP: '0x14'

  // for wrapping/unwrapping native
  // WRAP: "0x15",
  // UNWRAP: "0x16",
}
export const V4_ACTION_DESCRIPTORS = {
  // Liquidity commands
  INCREASE_LIQUIDITY: [
    { name: 'tokenId', type: 'uint256' },
    { name: 'liquidity', type: 'uint256' },
    { name: 'amount0Max', type: 'uint128' },
    { name: 'amount1Max', type: 'uint128' },
    { name: 'hookData', type: 'bytes' }
  ],
  DECREASE_LIQUIDITY: [
    { name: 'tokenId', type: 'uint256' },
    { name: 'liquidity', type: 'uint256' },
    { name: 'amount0Min', type: 'uint128' },
    { name: 'amount1Min', type: 'uint128' },
    { name: 'hookData', type: 'bytes' }
  ],
  // MINT_POSITION: [
  //   { name: 'poolKey', type: POOL_KEY_STRUCT, subparser: Subparser.PoolKey },
  //   { name: 'tickLower', type: 'int24' },
  //   { name: 'tickUpper', type: 'int24' },
  //   { name: 'liquidity', type: 'uint256' },
  //   { name: 'amount0Max', type: 'uint128' },
  //   { name: 'amount1Max', type: 'uint128' },
  //   { name: 'owner', type: 'address' },
  //   { name: 'hookData', type: 'bytes' }
  // ],
  BURN_POSITION: [
    { name: 'tokenId', type: 'uint256' },
    { name: 'amount0Min', type: 'uint128' },
    { name: 'amount1Min', type: 'uint128' },
    { name: 'hookData', type: 'bytes' }
  ],

  // Swapping commands
  SWAP_EXACT_IN_SINGLE: [
    { name: 'swap', type: SWAP_EXACT_IN_SINGLE_STRUCT, subparser: Subparser.V4SwapExactInSingle }
  ],
  SWAP_EXACT_IN: [{ name: 'swap', type: SWAP_EXACT_IN_STRUCT, subparser: Subparser.V4SwapExactIn }],
  SWAP_EXACT_OUT_SINGLE: [
    { name: 'swap', type: SWAP_EXACT_OUT_SINGLE_STRUCT, subparser: Subparser.V4SwapExactOutSingle }
  ],
  SWAP_EXACT_OUT: [
    { name: 'swap', type: SWAP_EXACT_OUT_STRUCT, subparser: Subparser.V4SwapExactOut }
  ],

  // Payments commands
  SETTLE: [
    { name: 'currency', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'payerIsUser', type: 'bool' }
  ],
  SETTLE_ALL: [
    { name: 'currency', type: 'address' },
    { name: 'maxAmount', type: 'uint256' }
  ],
  SETTLE_PAIR: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' }
  ],
  TAKE: [
    { name: 'currency', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' }
  ],
  TAKE_ALL: [
    { name: 'currency', type: 'address' },
    { name: 'minAmount', type: 'uint256' }
  ],
  TAKE_PORTION: [
    { name: 'currency', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'bips', type: 'uint256' }
  ],
  TAKE_PAIR: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'recipient', type: 'address' }
  ],
  CLOSE_CURRENCY: [{ name: 'currency', type: 'address' }],
  SWEEP: [
    { name: 'currency', type: 'address' },
    { name: 'recipient', type: 'address' }
  ]
}
