import { EIP7702Auth } from '../consts/7702'
import { Hex } from './hex'

export interface ChainIdWithUserOp {
  chainId: Hex
  userOperation: SignUserOperation
}

export interface PartialOperation {
  chainId: bigint
  sender: string
  callData: string // hex string
  callGasLimit: string
  verificationGasLimit: string
  preVerificationGas: string
}

export interface SignUserOperation {
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
  paymasterSignature?: string // hex string
  signature?: string // hex string
  eip7702Auth?: EIP7702Auth
}
