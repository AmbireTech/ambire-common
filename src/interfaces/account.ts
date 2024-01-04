export type AccountId = string

export interface Account {
  addr: AccountId
  // Associated keys that can control thte account
  // For EOAs thits must be set to [account.addr]
  associatedKeys: string[]
  initialPrivileges: [string, string][]
  // Creation data; `null` in case of an EOA
  creation: AccountCreation | null
  email?: string
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
  // this is a number and not a bigint because of ethers (it uses number for nonces)
  nonce: bigint
  erc4337Nonce: bigint
  associatedKeysPriviliges: { [key: string]: string }
  deployError: boolean
  balance: bigint
  isEOA: boolean
  isErc4337Enabled: boolean
  isErc4337Nonce: boolean
  isV2: boolean
}

export type AccountStates = {
  [accountId: string]: {
    [networkId: string]: AccountOnchainState
  }
}
