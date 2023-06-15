import { Storage } from '../../interfaces/storage'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Account } from '../../interfaces/account'
import { AccountOp } from '../../libs/accountOp/accountOp'

export interface Call {
  to: string
  value: bigint
  data: string
}
// @TODO: typed message
export interface Message {
  content: string
}

export interface UserRequest {
  id: bigint
  added: bigint // timestamp
  chainId: bigint
  accountId: string
  // either-or here between call and a message, plus different types of messages
  action: Call | Message
}
// import fetch from 'node-fetch'
// import { JsonRpcProvider } from 'ethers'

// type State = Map<AccountId, Map<NetworkId, any>>

export class MainController {
  // pending: PortfolioState
  private storage: any

  constructor(storage: Storage) {
    this.storage = storage
  }
}
