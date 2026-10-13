import { Account } from './account'
import { ControllerInterface } from './controller'
import { Hex } from './hex'

export type ISafeController = ControllerInterface<
  InstanceType<typeof import('../controllers/safe/safe').SafeController>
>

export interface SafeAccountByOwner extends Account {
  deployedOn: bigint[]
}

export interface SafeTx {
  to: Hex
  value: Hex
  data: Hex
  operation: number
  safeTxGas: Hex
  baseGas: Hex
  gasPrice: Hex
  gasToken: Hex
  refundReceiver: Hex
  nonce: Hex
}

/**
 * Why the activation of a Safe on a network couldn't be prepared. Sent to the UI as a code,
 * so the UI picks and translates the text it shows:
 * - `unavailable` - the Safe can't be activated on this network from the wallet
 * - `preparation-failed` - preparing it failed for a reason that may be temporary
 */
export type SafeDeploymentRequestError = 'unavailable' | 'preparation-failed'
