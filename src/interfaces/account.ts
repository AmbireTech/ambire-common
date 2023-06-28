export type AccountId = string

export interface Account {
  addr: AccountId
  label: string
  // URL (https, ipfs or nft721://contractAddr/tokenId)
  pfp: string
  // Associated keys that can control thte account
  // For EOAs thits must be set to [account.addr]
  associatedKeys: string[]
  // Creation data; `null` in case of an EOA
  creation: AccountCreation | null
}

export interface AccountCreation {
  factoryAddr: string
  bytecode: string
  salt: string
  // baseIdentityAddr is intentionally omitted because it's not used anywhere
  // and because it can be retrieved from the bytecode
}

export interface AccountOnchainState {
  accountAddr: string
  isDeployed: boolean
  nonce: number
  associatedKeys: { [key: string]: string }
  deployError: boolean
}
