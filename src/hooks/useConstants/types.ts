export interface UseConstantsProps {
  fetch: any
  endpoint: string
}

export interface UseConstantsReturnType {
  constants: ConstantsType | null
  isLoading: boolean
  retryFetch: () => void
  getAdexToStakingTransfersLogs: () => Promise<AdexToStakingTransfersLogsType | null>
  hasError: boolean
}

export interface AdexToStakingTransfersLogsType {
  jsonrpc: string
  id: number
  result: object[]
}

export interface ResultEndpointResponse {
  tokenList: ConstantsType['tokenList']
  humanizerInfo: ConstantsType['humanizerInfo']
}

// All the below types are generated with the help of QuickType app.
// However, they are not directly copy-pasted, but manually wired-up,
// because the raw generated types were a bit misleading and too specific
// (expecially for the `HumanizerInfoAbisType`).
// {@link https://app.quicktype.io/}
export interface ConstantsType {
  tokenList: { [key: string]: TokenList[] }
  humanizerInfo: HumanizerInfoType
  lastFetched: number
}

interface TokenList {
  address: string
  symbol: string
  coingeckoId?: null | string
  decimals?: number
  decmals?: number
}

export interface HumanizerInfoType {
  abis: HumanizerInfoAbisType
  tokens: { [key: string]: Array<number | null | string> }
  names: { [address: string]: string }
  yearnVaults: Vault[]
  tesseractVaults: Vault[]
}

interface Vault {
  name: string
  network: 'ethereum' | 'polygon'
  addr: string
  baseToken: string
  decimals?: number
  abiName?: string
}

enum AbiType {
  Constructor = 'constructor',
  Event = 'event',
  Fallback = 'fallback',
  Function = 'function',
  Receive = 'receive'
}

interface Input {
  indexed?: boolean
  internalType?: string
  name: string
  type: InputType
  components?: Input[]
}

interface Output {
  name: string
  type: InputType
}

enum InputType {
  Address = 'address',
  Address14 = 'address[14]',
  Address20 = 'address[20]',
  Address7 = 'address[7]',
  Bool = 'bool',
  Bytes = 'bytes',
  Bytes32 = 'bytes32',
  Bytes325 = 'bytes32[5]',
  Bytes4 = 'bytes4',
  Int24 = 'int24',
  Int256 = 'int256',
  String = 'string',
  Tuple = 'tuple',
  TypeAddress = 'address[]',
  TypeBytes = 'bytes[]',
  TypeTuple = 'tuple[]',
  TypeUint128 = 'uint128[]',
  TypeUint256 = 'uint256[]',
  Uint128 = 'uint128',
  Uint16 = 'uint16',
  Uint160 = 'uint160',
  Uint24 = 'uint24',
  Uint256 = 'uint256',
  Uint25618 = 'uint256[18]',
  Uint2569 = 'uint256[9]',
  Uint32 = 'uint32',
  Uint40 = 'uint40',
  Uint8 = 'uint8',
  Uint82 = 'uint8[2]',
  Uint88 = 'uint8[8]'
}

enum StateMutability {
  Nonpayable = 'nonpayable',
  Payable = 'payable',
  Pure = 'pure',
  View = 'view'
}

interface HumanizerInfoAbiType {
  constant?: boolean
  payable?: boolean
  anonymous?: boolean
  outputs?: Output[]
  inputs?: Input[]
  stateMutability?: StateMutability
  type: AbiType
  gas?: number
}

type HumanizerInfoAbisKeysType =
  | 'AaveWethGatewayV2'
  | 'PancakeRouter'
  | 'UniV2Router'
  | 'UniV3Router'
  | 'UniV3Router2'
  | 'WETH'
  | 'AaveLendingPoolV2'
  | 'MovrRouter'
  | 'MovrAnyswap'
  | 'ERC721'
  | 'YearnVault'
  | 'IdentityFactory'
  | 'Batcher'
  | 'StakingPool'
  | 'WyvernExchange'
  | 'Swappin'
  | 'ERC20'

type HumanizerInfoAbisType = {
  [key in HumanizerInfoAbisKeysType]: HumanizerInfoAbiType[]
}
