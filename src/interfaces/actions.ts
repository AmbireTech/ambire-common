import { AccountOp } from '../libs/accountOp/accountOp'
import { Account } from './account'
import { DappUserRequest, SignUserRequest, UserRequest } from './userRequest'

export type SwitchAccountAction = {
  id: UserRequest['id']
  type: 'switchAccount'
  userRequest: {
    meta: {
      accountAddr: Account['addr']
      switchToAccountAddr: Account['addr']
    }
  }
}

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

export type SwapAndBridgeAction = {
  id: UserRequest['id']
  type: 'swapAndBridge'
  userRequest: {
    meta: {
      accountAddr: Account['addr']
    }
  }
}

export type TransferAction = {
  id: UserRequest['id']
  type: 'transfer'
  userRequest: {
    meta: {
      accountAddr: Account['addr']
    }
  }
}

export type Action =
  | SwitchAccountAction
  | AccountOpAction
  | SignMessageAction
  | BenzinAction
  | DappRequestAction
  | SwapAndBridgeAction
  | TransferAction
