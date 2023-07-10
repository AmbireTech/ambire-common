import { NetworkId } from '../../interfaces/networkDescriptor'

interface Call {
  to: string
  value: bigint
  data: string
  // if this call is associated with a particular user request
  // multiple calls can be associated with the same user request, for example
  // when a batching request is made
  fromUserRequestId?: bigint
}

export enum GasFeePaymentType {
  // when a paymaster is used, we put it in the `paidBy` instead of the accountAddr
  ERC4337 = 'erc4337',
  AmbireRelayer = 'ambireRelayer',
  AmbireGasTank = 'ambireGasTank',
  // we use this in two cases: 1) Ambire account, fee paid by an EOA 2) account itself is an EAO
  // when the account itself is an EOA, paymentType equals accountAddr
  EOA = 'eoa'
}
interface GasFeePayment {
  paymentType: GasFeePaymentType
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
  // This is used when we have an account recovery to finalize before executing the AccountOp,
  // And we set this to the recovery finalization AccountOp; could be used in other scenarios too in the future,
  // for example account migration (from v1 QuickAcc to v2)
  accountOpToExecuteBefore: AccountOp | null
  // This is fed into the humanizer to help visualize the accountOp
  // This can contain info like the value of specific share tokens at the time of signing,
  // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
  // "remembered" at the time of signing in order to visualize history properly
  humanizerMeta?: { [key: string]: any }
}

export function callToTuple(call: Call): [string, bigint, string] {
  return [call.to, call.value, call.data]
}

export function isEOA(op: AccountOp): boolean {
  if (op.gasFeePayment === null) throw new Error('missing gasFeePayment')
  return op.gasFeePayment.paymentType === GasFeePaymentType.EOA
    && op.gasFeePayment.paidBy === op.accountAddr
}

export function canBroadcast(op: AccountOp, accountIsEOA: boolean): boolean {
  if (op.signingKeyAddr === null) throw new Error('missing signingKeyAddr')
  if (op.signature === null) throw new Error('missing signature')
  if (op.gasFeePayment === null) throw new Error('missing gasFeePayment')
  if (op.gasLimit === null) throw new Error('missing gasLimit')
  if (op.nonce === null) throw new Error('missing nonce')
  if (accountIsEOA) {
    if (op.gasFeePayment.paymentType !== GasFeePaymentType.EOA) throw new Error('gas fee payment type is not EOA')
    if (op.gasFeePayment.paidBy !== op.accountAddr) throw new Error('gas fee payment cannot be paid by anyone other than the EOA that signed it')
  }
  return true
}
