export interface UserOperation {
  sender: string
  nonce: string // hex string
  initCode: string // hex string
  callData: string // hex string
  callGasLimit: string // hex string
  verificationGasLimit: string // hex string
  preVerificationGas: string // hex string
  maxFeePerGas: string // hex string
  maxPriorityFeePerGas: string // hex string
  paymasterAndData: string // hex string
  signature: string // hex string
  // https://github.com/AmbireTech/ambire-app/wiki/Ambire-Flows-(wrap,-sign,-payment,-broadcast)#erc-4337-edge-case
  isEdgeCase: boolean
}
