import { Dapp } from '../../interfaces/dapp'
import { Hex } from '../../interfaces/hex'
// TODO: Rework in a way to avoid a dependency cycle
// eslint-disable-next-line import/no-cycle
import { Calls, UserRequest } from '../../interfaces/userRequest'

export enum AccountOpStatus {
  Pending = 'pending',
  BroadcastedButNotConfirmed = 'broadcasted-but-not-confirmed',
  Success = 'success',
  Failure = 'failure',
  Rejected = 'rejected',
  UnknownButPastNonce = 'unknown-but-past-nonce',
  BroadcastButStuck = 'broadcast-but-stuck'
}

export interface Call {
  to?: string | undefined
  value: bigint
  data: string
  // if this call is associated with a particular user request
  // multiple calls can be associated with the same user request, for example
  // when a batching request is made
  fromUserRequestId?: UserRequest['id']
  id?: Calls['calls'][number]['id']
  txnId?: Hex
  status?: AccountOpStatus
  fee?: {
    inToken: string
    amount: bigint
  }
  validationError?: string
  dapp?: Dapp
}
