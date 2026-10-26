import type { EthereumProvider } from '@kohaku-eth/provider'

import { ControllerInterface } from './controller'
import { Hex } from './hex'

export type ITornadoCashController = ControllerInterface<
  InstanceType<typeof import('../controllers/tornadoCash/tornadoCash').TornadoCashController>
>

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

/** At most one per stored recovery phrase, and removed with it. */
export type TornadoCashAccount = {
  seedId: string
  createdAt: number
}

/** Why Tornado Cash cannot act for the selected account. */
export type TornadoCashUnavailableReason =
  /** No Tornado Cash account is selected. */
  | 'no-account'
  /** This platform cannot run the SDK (mobile, Firefox). */
  | 'unsupported-platform'
  /** The user removed Ethereum, the only network Tornado Cash supports here. */
  | 'unsupported-network'
  | 'locked'

export type TornadoCashSyncStatus = 'idle' | 'syncing' | 'ready'

/** The selected account's sync. Nothing of it is kept for another account. */
export type TornadoCashSyncState = {
  status: TornadoCashSyncStatus
  startedAt: number | null
  lastSyncedAt: number | null
  lastSyncDuration: number | null
  /** The last sync failed, in plain words. Cleared by the next one that works. */
  error: string | null
}

/** One asset's notes in the selected account. */
export type TornadoCashTokenBalance = {
  assetAddress: string
  symbol: string
  decimals: number
  /** The sum of the notes. */
  amount: bigint
  /** How many notes of each amount, largest first. */
  notes: { denomination: bigint; count: number }[]
}

/** A send from the selected Tornado Cash account. Never stored. */
export type TornadoCashOperation = {
  id: number
  /** Proving and signing, waiting for the user's go, being sent, waiting to be included. */
  phase: 'proving' | 'ready' | 'broadcasting' | 'finalizing'
  status: 'pending' | 'success' | 'failed'
  assetAddress: string
  symbol: string
  decimals: number
  recipient: string
  /** What leaves the account: whole notes. */
  amount: bigint
  /** Paid to the paymaster from the notes, known once ready. */
  fee: bigint | null
  /** `amount - fee`, known once ready. */
  recipientReceives: bigint | null
  notesCount: number
  /** In plain words, when it failed. */
  error: string | null
  userOpHash: string | null
}
