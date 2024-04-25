import { Call } from '../accountOp/types'

export type UserOpRequestType = 'standard' | 'activator' | 'recovery'

export interface UserOperation {
  sender: string
  nonce: string // hex string
  initCode: string // hex string
  callData: string // hex string
  accountGasLimits: string
  preVerificationGas: string // hex string
  gasFees: string
  paymasterAndData: string // hex string
  signature: string // hex string
  // https://github.com/AmbireTech/ambire-app/wiki/Ambire-Flows-(wrap,-sign,-payment,-broadcast)#erc-4337-edge-case
  requestType: UserOpRequestType
  activatorCall?: Call
}

export interface UnPackedUserOperation {
  sender: string
  nonce: string // hex string
  initCode: string // hex string
  callData: string // hex string
  callGasLimit: string
  verificationGasLimit: string
  preVerificationGas: string // hex string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  paymasterAndData: string // hex string
  signature: string // hex string
  // https://github.com/AmbireTech/ambire-app/wiki/Ambire-Flows-(wrap,-sign,-payment,-broadcast)#erc-4337-edge-case
  requestType: UserOpRequestType
  activatorCall?: Call
}
