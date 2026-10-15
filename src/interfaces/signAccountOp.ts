import { ControllerInterface } from './controller'

export type ISignAccountOpController = ControllerInterface<
  InstanceType<typeof import('../controllers/signAccountOp/signAccountOp').SignAccountOpController>
>

export enum SigningStatus {
  EstimationError = 'estimation-error',
  UnableToSign = 'unable-to-sign',
  ReadyToSign = 'ready-to-sign',
  /**
   * Used to prevent state updates while the user is resolving warnings, connecting a hardware wallet, etc.
   * Signing is allowed in this state, but the state of the controller should not change.
   */
  UpdatesPaused = 'updates-paused',
  InProgress = 'in-progress',
  WaitingForPaymaster = 'waiting-for-paymaster-response',
  Done = 'done',
  Queued = 'queued',
  SafeQuickBroadcastBundler = 'safe-quick-broadcast-bundler'
}

export type Status = {
  // @TODO: get rid of the object and just use the type
  type: SigningStatus
}

export enum FeeSpeed {
  Slow = 'slow',
  Medium = 'medium',
  Fast = 'fast',
  Ape = 'ape'
}

export type SpeedCalc = {
  type: FeeSpeed
  amount: bigint
  simulatedGasLimit: bigint
  amountFormatted: string
  amountUsd: string
  gasPrice: bigint
  disabled: boolean
  maxPriorityFeePerGas?: bigint
}

export const noStateUpdateStatuses = [
  SigningStatus.InProgress,
  SigningStatus.Done,
  SigningStatus.UpdatesPaused,
  SigningStatus.WaitingForPaymaster,
  SigningStatus.SafeQuickBroadcastBundler
]

type Warning = {
  id: string
  title: string
  text?: string
  secondaryText?: string
  promptBefore?: ('sign' | 'one-click-sign')[]
  type?: Type
}

type Type = 'error' | 'warning' | 'info'

type SignAccountOpError = {
  title: string
  code?: string
  text?: string
  action?: 'refetch-account-state'
}

type SignAccountOpBanner = {
  id: string
  type: 'error' | 'warning'
  title?: string
  text: string
  secondaryText?: string
  /** Mirrors DappVerificationBanner.trustableDappUrls - set only on the SUSPICIOUS_HOSTING banner. */
  trustableDappUrls?: string[]
}

/**
 * How the EOAs that can pay a Safe's fee relate to it (lowercased addresses). Paying from an
 * owner or an already linked EOA reveals nothing new, any other EOA gets publicly linked to it.
 */
type SafeFeePayerLinks = {
  /** The Safe's owners on the transaction's chain */
  owners: string[]
  /** EOAs that already paid a fee for the Safe on this chain, excluding the owners */
  linked: string[]
  /** The EOA that paid the Safe's latest fee on this chain (an owner or a linked one), if any */
  lastUsed: string | null
}

type HardwareWalletSigningRequest = {
  type: 'raw-transaction' | 'eip-712' | 'eip-7702-authorization' | 'message'
  data: unknown
}

enum TraceCallDiscoveryStatus {
  NotStarted = 'not-started',
  InProgress = 'in-progress',
  Done = 'done',
  Failed = 'failed'
}

export { TraceCallDiscoveryStatus }
export type {
  HardwareWalletSigningRequest,
  SafeFeePayerLinks,
  SignAccountOpBanner,
  SignAccountOpError,
  Warning
}
