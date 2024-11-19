import { AccountOp } from '../libs/accountOp/accountOp'
import { DappUserRequest, SignUserRequest, UserRequest } from './userRequest'

export type AccountOpAction = {
  id: SignUserRequest['id']
  type: 'accountOp'
  accountOp: AccountOp
}

export type SignMessageAction = {
  id: SignUserRequest['id']
  type: 'signMessage'
  userRequest: SignUserRequest
}

export type BenzinAction = {
  id: UserRequest['id']
  type: 'benzin'
  userRequest: SignUserRequest
}

export type DappRequestAction = {
  id: UserRequest['id']
  type: 'dappRequest'
  userRequest: DappUserRequest
}

export type Action = AccountOpAction | SignMessageAction | BenzinAction | DappRequestAction
