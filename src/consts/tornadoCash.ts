import { Hex } from '../interfaces/hex'
import { getPrivacyPoolsBundlerUrl } from './privacyPools'

/**
 * Fixed so a phrase alone recovers its notes, at the cost of one identity per phrase. Never infer
 * another index: a wrong one points the wallet at an empty set of notes.
 */
export const TORNADO_CASH_ACCOUNT_INDEX = 0

/**
 * The account's branch of the SDK's derivation scheme. Below it, the SDK asks for one key per
 * note and kind: `/{kind}'/{depositIndex}'`, where kind is 0 (nullifier), 1 (salt) or 2 (the
 * paymaster withdrawal signer).
 *
 * Security boundary: `KeystoreController.derivePrivacyKey` refuses any other path, since the
 * plugin asks for arbitrary paths and could otherwise reach the user's EVM keys.
 */
export const TORNADO_CASH_ACCOUNT_KEY_PATH = `m/29795'/1'/${TORNADO_CASH_ACCOUNT_INDEX}'`

/** The key kinds the SDK derives per note - see `TORNADO_CASH_ACCOUNT_KEY_PATH`. */
export const TORNADO_CASH_NOTE_KEY_KINDS = [0, 1, 2] as const

/** Ethereum only: the SDK supports Sepolia too, but the wallet ships mainnet alone. */
export const TORNADO_CASH_CHAIN_ID = 1n

/**
 * fatlabs' CDN publishes every Tornado Cash pool's history (and the relayer registry's) as signed,
 * content-addressed files: a cold read takes about 40 s instead of thousands of `eth_getLogs`.
 */
export const TORNADO_CASH_SAGA_SYNC_URL = 'https://saga.fatsolutions.xyz'

/** The ERC-4337 paymaster that sponsors withdrawals, paid from the withdrawn note itself. */
export const TORNADO_CASH_PAYMASTER = {
  entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
  paymasterAddress: '0xe06CB96C57D2442f8F60F5017354BC08F7e91308'
} as const

/** A Tornado Cash pool: it holds notes of one asset, each worth exactly `denomination`. */
export type TornadoCashPool = {
  /** Lowercase. */
  address: Hex
  /** The wallet's address of the asset: the zero address for ETH. */
  assetAddress: string
  symbol: string
  decimals: number
  denomination: bigint
  /** The paymaster's fee adapter for this pool, without which nothing could be withdrawn. */
  feeAdapterAddress: Hex
}

const ETH = {
  assetAddress: '0x0000000000000000000000000000000000000000',
  symbol: 'ETH',
  decimals: 18
}
const DAI = {
  assetAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  symbol: 'DAI',
  decimals: 18
}
const USDC = {
  assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  decimals: 6
}
const USDT = {
  assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  symbol: 'USDT',
  decimals: 6
}
const WBTC = {
  assetAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  symbol: 'WBTC',
  decimals: 8
}

/**
 * The mainnet pools the wallet supports: those the paymaster sponsors. The registry also lists cDAI
 * pools, which nothing could withdraw from.
 *
 * Checked on chain (each adapter's `TORNADO_INSTANCE()` and each pool's `denomination()`), and
 * passed to the SDK as its paymaster config: its own `TornadoPaymasterConfigs` swaps the two USDC
 * pools' adapters (0.0.2-alpha.25), which would make every USDC withdrawal fail.
 */
export const TORNADO_CASH_POOLS: readonly TornadoCashPool[] = [
  {
    ...ETH,
    address: '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc',
    denomination: 10n ** 17n,
    feeAdapterAddress: '0x4a3F73a23563bB467Aa034d0fAB61e7BcDf26161'
  },
  {
    ...ETH,
    address: '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936',
    denomination: 10n ** 18n,
    feeAdapterAddress: '0xC086b50Dd859Bb15D553327178DEdbC347B5b905'
  },
  {
    ...ETH,
    address: '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf',
    denomination: 10n ** 19n,
    feeAdapterAddress: '0x08d1103bff53CBdC9DB1e81B79475CEad2e35870'
  },
  {
    ...ETH,
    address: '0xa160cdab225685da1d56aa342ad8841c3b53f291',
    denomination: 10n ** 20n,
    feeAdapterAddress: '0x3aF851f9BeEeE6E9fa06022f34Dc4C453D265aE5'
  },
  {
    ...DAI,
    address: '0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3',
    denomination: 10n ** 20n,
    feeAdapterAddress: '0xe6be288aeCa9FAB56D9792686Ec571Fb1AF37F55'
  },
  {
    ...DAI,
    address: '0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144',
    denomination: 10n ** 21n,
    feeAdapterAddress: '0xf6f35246EbDA061bB17b6C7ED7B7049065eD61f3'
  },
  {
    ...DAI,
    address: '0x07687e702b410fa43f4cb4af7fa097918ffd2730',
    denomination: 10n ** 22n,
    feeAdapterAddress: '0x36A5b4bCE77700B9C52cFEE53Fc8cA3B58eb7E35'
  },
  {
    ...DAI,
    address: '0x23773e65ed146a459791799d01336db287f25334',
    denomination: 10n ** 23n,
    feeAdapterAddress: '0x83Ff713F0939409E1c6023bc8aaB3E49eD968c8D'
  },
  {
    ...USDC,
    address: '0xd96f2b1c14db8458374d9aca76e26c3d18364307',
    denomination: 10n ** 8n,
    feeAdapterAddress: '0xB1C7e712AF153073979AdC5ef8B1Cc5A7b0cf031'
  },
  {
    ...USDC,
    address: '0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d',
    denomination: 10n ** 9n,
    feeAdapterAddress: '0x44336242f9766b4c751F6958499C5cc18325e25B'
  },
  {
    ...USDT,
    address: '0x169ad27a470d064dede56a2d3ff727986b15d52b',
    denomination: 10n ** 8n,
    feeAdapterAddress: '0xF006862cCa4829D3f3ddD52d93fC49C03D380a5F'
  },
  {
    ...USDT,
    address: '0x0836222f2b2b24a3f36f98668ed8f0b38d1a872f',
    denomination: 10n ** 9n,
    feeAdapterAddress: '0x5DF524b6c9303eD94A7767c2eD787ee223c9bC54'
  },
  {
    ...WBTC,
    address: '0x178169b423a011fff22b9e3f3abea13414ddd0f1',
    denomination: 10n ** 7n,
    feeAdapterAddress: '0x0fdF2f686B600523F9752aEca0abb6AD9603A22C'
  },
  {
    ...WBTC,
    address: '0x610b717796ad172b316836ac95a2ffad065ceab4',
    denomination: 10n ** 8n,
    feeAdapterAddress: '0xec3Cca694EEe55808B3f5EFEDd0bC03E52e47834'
  },
  {
    ...WBTC,
    address: '0xbb93e510bbcd0b7beb5a853875f9ec60275cf498',
    denomination: 10n ** 9n,
    feeAdapterAddress: '0xC2C427E6ADF66F412921C17958CeDD9C7710F521'
  }
]

/** The SDK's native ETH sentinel, as the asset of `prepareShield` and `prepareUnshield`. */
export const TORNADO_CASH_NATIVE_ASSET_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/**
 * Where the extension serves the proving artifacts and the SDK's workers, relative to its root.
 * Filenames must match scripts/fetch-tornado-cash-artifacts.js and webpack/extension.js.
 */
export const TORNADO_CASH_ASSET_PATHS = {
  baseDir: 'tornado-cash/',
  circuit: 'tornado.json',
  provingKey: 'tornadoProvingKey.bin',
  stateManagerWorker: 'state-manager.worker.js'
} as const

export const TORNADO_CASH_ACCOUNTS_STORAGE_KEY = 'tornadoCashAccounts'

/**
 * The most notes one send creates. Each note is its own deposit call, so this bounds the
 * transaction's size and fee.
 */
export const TORNADO_CASH_MAX_NOTES_PER_DEPOSIT = 10

/** Withdrawals go through the same Pimlico bundler as Privacy Pools'. */
export const getTornadoCashBundlerUrl = getPrivacyPoolsBundlerUrl
