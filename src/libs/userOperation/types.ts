import { EIP7702Auth } from '../../consts/7702'
import { BUNDLER } from '../../consts/bundlers'
import { Hex } from '../../interfaces/hex'
import { Call } from '../accountOp/types'

export type UserOpRequestType = 'standard' | 'activator' | 'recovery' | '7702'

export interface PackedUserOperation {
  sender: string
  nonce: bigint
  initCode: Hex
  callData: Hex
  // callGasLimit + verificationGasLimit
  accountGasLimits: Hex
  preVerificationGas: bigint
  // maxFeePerGas + maxPriorityFeePerGas
  gasFees: Hex
  paymasterAndData: Hex
  signature?: Hex
}

export interface UserOperation {
  sender: string
  nonce: string
  factory?: string // hex string
  factoryData?: string // hex string
  callData: string // hex string
  callGasLimit: string
  verificationGasLimit: string
  preVerificationGas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  paymaster?: string // hex string
  paymasterVerificationGasLimit?: string
  paymasterPostOpGasLimit?: string
  paymasterData?: string // hex string
  signature: string // hex string
  // https://github.com/AmbireTech/ambire-app/wiki/Ambire-Flows-(wrap,-sign,-payment,-broadcast)#erc-4337-edge-case
  requestType: UserOpRequestType
  activatorCall?: Call
  // which bundler is responsible for submitting and fetching info
  // about this userOp
  bundler: BUNDLER
  eip7702Auth?: EIP7702Auth
}

export interface UserOperationEventData {
  nonce: Number
  success: boolean
}
