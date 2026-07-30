import { ControllerInterface } from './controller'
import { Account } from './account'
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
