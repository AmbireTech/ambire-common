export type AccountId = string

export interface Account {
  addr: AccountId
  label: string
  // URL (https, ipfs or nft721://contractAddr/tokenId)
  pfp: string
  associatedKeys: string[]
  // Creation data
  factoryAddr: string
  bytecode: string
  salt: string
  // baseIdentityAddr is intentionally omitted because it's not used anywhere
  // and because it can be retrieved from the bytecode
}
