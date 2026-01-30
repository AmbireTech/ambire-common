import { ControllerInterface } from './controller'
import { Hex } from './hex'

export type ISafeController = ControllerInterface<
  InstanceType<typeof import('../controllers/safe/safe').SafeController>
>

export interface SafeTx {
  to: Hex
  value: bigint
  data: Hex
  operation: number
  safeTxGas: bigint
  baseGas: bigint
  gasPrice: bigint
  gasToken: Hex
  refundReceiver: Hex
  nonce: bigint
}
