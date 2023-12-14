import { Provider } from 'ethers'

import AmbireAccountState from '../../../contracts/compiled/AmbireAccountState.json'
import { MAX_UINT256 } from '../../consts/deploy'
import { Account, AccountOnchainState, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getAccountDeployParams } from '../account/account'
import { fromDescriptor } from '../deployless/deployless'

export async function getAccountState(
  provider: Provider,
  network: NetworkDescriptor,
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
      network?.erc4337?.enabled &&
      !account.associatedKeys.includes(network?.erc4337?.entryPointAddr)
        ? [...account.associatedKeys, network?.erc4337?.entryPointAddr]
        : account.associatedKeys

    return [
      account.addr,
      associatedKeys,
      ...(account.creation == null
        ? ['0x0000000000000000000000000000000000000000', '0x']
        : getAccountDeployParams(account)),
      network?.erc4337?.enabled
        ? network?.erc4337?.entryPointAddr
        : '0x0000000000000000000000000000000000000000'
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
            associatedKey[0] === network?.erc4337?.entryPointAddr &&
            (associatedKey[1] === network.erc4337?.entryPointMarker ||
              associatedKey[1] === `0x${'0'.repeat(63)}1`)
        )
      ),
      deployError:
        accounts[index].associatedKeys.length > 0 && accResult.associatedKeyPrivileges.length === 0
    }

    return res
  })

  return result
}

export const getNetworksWithFailedRPC = ({
  accountStates,
  networks
}: {
  accountStates: AccountStates
  networks: NetworkDescriptor[]
}): string[] => {
  let networksWithFailedRPC: string[] = []
  Object.keys(accountStates).forEach((account) => {
    const currentAccount = accountStates[account]

    // Check if all networks have accounts states. Ones that don't are the ones with failed RPC.
    networks.forEach((network) => {
      if (!currentAccount[network.id]) {
        if (networksWithFailedRPC.includes(network.id)) return

        networksWithFailedRPC.push(network.id)
        return
      }

      networksWithFailedRPC = networksWithFailedRPC.filter((n) => network.id !== n)
    })
  })

  return networksWithFailedRPC
}
