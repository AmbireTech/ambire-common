import { Call } from '../accountOp/types'

export type UserOpRequestType = 'standard' | 'activator' | 'recovery'

export interface PaymasterUnpacked {
  paymaster: string // hex string
  paymasterVerificationGasLimit: string // hex string
  paymasterPostOpGasLimit: string // hex string
  paymasterData: string // hex string
}

export interface UserOperation {
  sender: string
  nonce: string
  factory: string // hex string
  factoryData: string // hex string
  callData: string // hex string
  callGasLimit: string
  verificationGasLimit: string
  preVerificationGas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  paymaster: string // hex string
  paymasterVerificationGasLimit: string
  paymasterPostOpGasLimit: string
  paymasterData: string // hex string
  signature: string // hex string
  // https://github.com/AmbireTech/ambire-app/wiki/Ambire-Flows-(wrap,-sign,-payment,-broadcast)#erc-4337-edge-case
  requestType: UserOpRequestType
  activatorCall?: Call
}
