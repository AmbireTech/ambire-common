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
  SafeQuickBroadcastBundler = 'safe-quick-broadcast-bundler',
  /**
   * The pending transaction that is being sped up was processed before the speed up was
   * signed, so its place (nonce) is taken and the speed up can't go through anymore.
   * Final, nothing can be signed in this state.
   */
  SpeedUpNotNeeded = 'speed-up-not-needed'
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
  SigningStatus.SafeQuickBroadcastBundler,
  SigningStatus.SpeedUpNotNeeded
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
export type { HardwareWalletSigningRequest, SignAccountOpBanner, SignAccountOpError, Warning }
