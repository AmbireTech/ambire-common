import type { EthereumProvider } from '@kohaku-eth/provider'

import { Hex } from './hex'

/** A note the account owns, without its secrets or commitment, which would link it to the account. */
export type TornadoCashNote = {
  /** Lowercase. */
  poolAddress: string
  /** The note's fixed amount, the pool's denomination. */
  amount: bigint
  /** The deposit's index in the account's derivation, per pool. */
  depositIndex: number
  /** Seconds since the epoch, from the deposit's block. */
  timestamp: number
}

/** A call the plugin built, such as a deposit into a pool. */
export type TornadoCashTx = {
  to: string
  data: string
  value: bigint
}

/** An ERC-4337 user operation as the bundler takes it, every number hex encoded. */
export type TornadoCashUserOperation = {
  sender: Hex
  nonce: Hex
  callData: Hex
  callGasLimit: Hex
  verificationGasLimit: Hex
  preVerificationGas: Hex
  maxFeePerGas: Hex
  maxPriorityFeePerGas: Hex
  paymaster?: Hex
  paymasterVerificationGasLimit?: Hex
  paymasterPostOpGasLimit?: Hex
  paymasterData?: Hex
  signature: Hex
  eip7702Auth?: {
    address: Hex
    chainId: Hex
    nonce: Hex
    r: Hex
    s: Hex
    yParity: Hex
  }
}

/** A signed withdrawal, sponsored by the paymaster, that only needs broadcasting. */
export type TornadoCashPaymasterWithdrawal = {
  /** The pool of the note the paymaster is paid from. Lowercase. */
  poolAddress: string
  entryPointAddress: Hex
  userOperation: TornadoCashUserOperation
}

/** What the plugin reaches in the background: it never gets the recovery phrase. */
export type TornadoCashPluginHost = {
  provider: EthereumProvider
  /** Must only derive Tornado Cash's paths - see `KeystoreController.derivePrivacyKey`. */
  deriveKey: (path: string) => Promise<Hex>
}

/**
 * One account's Tornado Cash plugin. The SDK always runs in Web Workers, which a service worker
 * cannot start, so the platform hosts it (in an offscreen document on Chrome) - see
 * `TornadoCashPluginFactory`.
 */
export type TornadoCashPlugin = {
  /** Reads the pools' new events and finds the account's notes. */
  sync(): Promise<void>
  /** The account's unspent notes, after a sync. */
  notes(): Promise<TornadoCashNote[]>
  /**
   * The deposit calls for `amount`, one per note. The SDK splits the amount itself and drops what
   * does not fit - check it with `splitIntoTornadoCashNotes` first.
   */
  prepareShield(params: { assetAddress: string; amount: bigint }): Promise<TornadoCashTx[]>
  /** Proves and signs a withdrawal of exactly `amount` to `recipient`, sponsored by the paymaster. */
  prepareUnshield(params: {
    assetAddress: string
    amount: bigint
    recipient: string
  }): Promise<TornadoCashPaymasterWithdrawal[]>
  /** Stops the plugin and its workers. The instance is unusable afterwards. */
  dispose(): Promise<void>
}

/**
 * Starts the plugin for one recovery phrase. Injected by the platform: undefined where the SDK
 * cannot run (mobile, Firefox), which leaves Tornado Cash unavailable.
 */
export type TornadoCashPluginFactory = (host: TornadoCashPluginHost) => Promise<TornadoCashPlugin>
