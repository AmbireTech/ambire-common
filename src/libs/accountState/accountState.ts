import { concat, Provider } from 'ethers'

import AmbireAccountState from '../../../contracts/compiled/AmbireAccountState.json'
import { ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT, MAX_UINT256 } from '../../consts/deploy'
import { InternalSignedMessages } from '../../controllers/activity/types'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { getContractImplementation } from '../7702/7702'
import { getAccountDeployParams, getAuthorization, isSmartAccount } from '../account/account'
import { fromDescriptor } from '../deployless/deployless'

export async function getAccountState(
  provider: Provider,
  network: Network,
  accounts: Account[],
  authorizations: InternalSignedMessages = {},
  blockTag: string | number = 'latest'
): Promise<AccountOnchainState[]> {
  const deploylessAccountState = fromDescriptor(
    provider,
    AmbireAccountState,
    !network.rpcNoStateOverride
  )

  const args = accounts.map((account) => {
    const associatedKeys =
      network.erc4337.enabled && !account.associatedKeys.includes(ERC_4337_ENTRYPOINT)
        ? [...account.associatedKeys, ERC_4337_ENTRYPOINT]
        : account.associatedKeys

    return [
      account.addr,
      associatedKeys,
      ...(account.creation == null
        ? ['0x0000000000000000000000000000000000000000', '0x']
        : getAccountDeployParams(account)),
      ERC_4337_ENTRYPOINT
    ]
  })

  async function getEOAsNonce(eoaAccounts: any[]): Promise<{ [addr: string]: number }> {
    const nonces: any = await Promise.all(
      eoaAccounts.map((addr: string) => provider.getTransactionCount(addr))
    )
    return Object.assign(
      {},
      ...eoaAccounts.map((addr: string, index: string | number) => ({
        [addr]: BigInt(nonces[index])
      }))
    )
  }

  async function getEOAsCode(eoaAccounts: any[]): Promise<{ [addr: string]: string }> {
    const codes: any = await Promise.all(eoaAccounts.map((addr: string) => provider.getCode(addr)))
    return Object.assign(
      {},
      ...eoaAccounts.map((addr: string, index: string | number) => ({
        [addr]: codes[index]
      }))
    )
  }

  const eoas = accounts.filter((account) => !isSmartAccount(account)).map((account) => account.addr)
  const [[accountStateResult], eoaNonces, eoaCodes] = await Promise.all([
    deploylessAccountState.call('getAccountsState', [args], {
      blockTag
    }),
    getEOAsNonce(eoas),
    getEOAsCode(eoas)
  ])

  const result: AccountOnchainState[] = accountStateResult.map((accResult: any, index: number) => {
    const associatedKeys = accResult.associatedKeyPrivileges.map(
      (privilege: string, keyIndex: number) => {
        return [args[index][1][keyIndex], privilege]
      }
    )

    const account = accounts[index]
    const authorization = getAuthorization(
      account,
      !account.creation ? BigInt(eoaNonces[account.addr]) : 0n,
      network,
      authorizations
    )

    // an EOA is smarter if it either:
    // - has an active authorization
    // - has an active AMBIRE delegation
    const isSmarterEoa =
      accResult.isEOA &&
      (!!authorization ||
        eoaCodes[account.addr] === concat(['0xef0100', getContractImplementation(network.chainId)]))

    const res = {
      accountAddr: account.addr,
      nonce: !isSmartAccount(account) ? eoaNonces[account.addr] : accResult.nonce,
      erc4337Nonce: accResult.erc4337Nonce,
      isDeployed: accResult.isDeployed,
      associatedKeys: Object.fromEntries(associatedKeys),
      isV2: accResult.isV2,
      balance: accResult.balance,
      isEOA: accResult.isEOA,
      isErc4337Enabled: isSmarterEoa
        ? true
        : !!(
            network.erc4337.enabled &&
            accResult.erc4337Nonce < MAX_UINT256 &&
            associatedKeys.find(
              (associatedKey: string[]) =>
                associatedKey[0] === ERC_4337_ENTRYPOINT && associatedKey[1] === ENTRY_POINT_MARKER
            )
          ),
      currentBlock: accResult.currentBlock,
      deployError:
        account.associatedKeys.length > 0 && accResult.associatedKeyPrivileges.length === 0,
      isSmarterEoa,
      authorization
    }

    return res
  })

  return result
}
