import { NetworkId } from '../../interfaces/networkDescriptor'

interface Call {
  to: string
  value: bigint
  data: string
}

enum GasFeePaymentType {
  // when a paymaster is used, we put it in the `paidBy` instead of the accountAddr
  ERC4337 = 'erc4337',
  AmbireRelayer = 'ambireRelayer',
  AmbireGasTank = 'ambireGasTank',
  EOA = 'eoa'
}
interface GasFeePayment {
  feePaymentType: GasFeePaymentType
  paidBy: string
  inToken: string
  amount: number
}

// Equivalent to ERC-4337 UserOp, but more universal than it since a AccountOp can be transformed to
// a UserOp, or to a direct EOA transaction, or relayed through the Ambire relayer
// it is more precisely defined than a UserOp though - UserOp just has calldata and this has individual `calls`
export interface AccountOp {
  accountAddr: string
  networkId: NetworkId
  // this may not be defined, in case the user has not picked a key yet
  signingKeyAddr: string | null
  // this may not be set in case we haven't set it yet
  nonce: number | null
  // @TODO: nonce namespace? it is dependent on gasFeePayment
  calls: Call[]
  gasLimit: number | null
  signature: string | null
  // @TODO separate interface
  gasFeePayment: GasFeePayment | null
  // @TODO: meta?
  // This is used when we have an account recovery to finalize before executing the AccountOp,
  // And we set this to the recovery finalization AccountOp; could be used in other scenarios too in the future
  accountOpToExecuteBefore: AccountOp | null
}

export function callToTuple(call: Call): [string, bigint, string] {
  return [call.to, call.value, call.data]
}
