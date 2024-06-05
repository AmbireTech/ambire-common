import { Provider } from 'ethers'

import AmbireAccountState from '../../../contracts/compiled/AmbireAccountState.json'
import { ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT, MAX_UINT256 } from '../../consts/deploy'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { getAccountDeployParams } from '../account/account'
import { fromDescriptor } from '../deployless/deployless'

export async function getAccountState(
  provider: Provider,
  network: Network,
  accounts: Account[],
  blockTag: string | number = 'latest'
): Promise<AccountOnchainState[]> {
  const deploylessAccountState = fromDescriptor(
    provider,
    AmbireAccountState,
    !network.rpcNoStateOverride
  )

  const args = accounts.map((account) => {
    const associatedKeys =
      network?.erc4337?.enabled && !account.associatedKeys.includes(ERC_4337_ENTRYPOINT)
        ? [...account.associatedKeys, ERC_4337_ENTRYPOINT]
        : account.associatedKeys

    return [
      account.addr,
      associatedKeys,
      ...(account.creation == null
        ? ['0x0000000000000000000000000000000000000000', '0x']
        : getAccountDeployParams(account)),
      network?.erc4337?.enabled ? ERC_4337_ENTRYPOINT : '0x0000000000000000000000000000000000000000'
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

  const [[accountStateResult], eoaNonces] = await Promise.all([
    deploylessAccountState.call('getAccountsState', [args], {
      blockTag
    }),
    getEOAsNonce(
      accounts
        .filter((account) => account.creation?.bytecode === '0x00')
        .map((account) => account.addr)
    )
  ])

  const result: AccountOnchainState[] = accountStateResult.map((accResult: any, index: number) => {
    const associatedKeys = accResult.associatedKeyPrivileges.map(
      (privilege: string, keyIndex: number) => {
        return [args[index][1][keyIndex], privilege]
      }
    )

    const res = {
      accountAddr: accounts[index].addr,
      nonce: eoaNonces[accounts[index].addr] || accResult.nonce,
      erc4337Nonce: accResult.erc4337Nonce,
      isDeployed: accResult.isDeployed,
      associatedKeys: Object.fromEntries(associatedKeys),
      isV2: accResult.isV2,
      balance: accResult.balance,
      isEOA: accResult.isEOA,
      isErc4337Enabled: !!(
        network?.erc4337?.enabled &&
        accResult.erc4337Nonce < MAX_UINT256 &&
        associatedKeys.find(
          (associatedKey: string[]) =>
            associatedKey[0] === ERC_4337_ENTRYPOINT && associatedKey[1] === ENTRY_POINT_MARKER
        )
      ),
      currentBlock: accResult.currentBlock,
      deployError:
        accounts[index].associatedKeys.length > 0 && accResult.associatedKeyPrivileges.length === 0
    }

    return res
  })

  return result
}
