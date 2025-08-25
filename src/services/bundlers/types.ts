import { Log } from 'ethers'
import { Hex } from '../../interfaces/hex'

export interface Gas {
  maxFeePerGas: Hex
  maxPriorityFeePerGas: Hex
}

export interface GasSpeeds {
  slow: Gas
  medium: Gas
  fast: Gas
  ape: Gas
}

export interface UserOpStatus {
  status:
    | 'rejected'
    | 'not_found'
    | 'found'
    | 'submitted'
    | 'not_submitted'
    | 'included'
    | 'failed'
    | 'queued'
  transactionHash?: Hex
}

export interface BundlerTransactionReceipt {
  success: boolean
  sender: string
  actualGasUsed: string
  actualGasCost: string
  logs: ReadonlyArray<Log>
  receipt: {
    status?: string | number
    transactionHash: string
    blockHash: string
    logs: ReadonlyArray<Log>
    blockNumber: string
    gasUsed: string
  }
}
