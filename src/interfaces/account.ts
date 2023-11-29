export type AccountId = string

export interface Account {
  addr: AccountId
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

export interface RelayerResponseLinkedAccount {
  keys: {
    [identityAddress: string]: {
      [network: string]: {
        [key: string]: string
      }
    }
  }
  accounts: {
    [identityAddr: string]: AccountCreation & {
      // @TODO: @NOTE: shouldn't this be just string, relayer sometimes returns boolean
      associatedKeys: { [key: string]: string | boolean }
      initialPrivilegesAddrs: string[]
    }
  }
}
