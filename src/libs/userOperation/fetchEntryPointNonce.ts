import { Interface } from 'ethers'
import entryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Account } from '../../interfaces/account'
import { RPCProvider } from '../../interfaces/provider'

export async function fetchNonce(account: Account, provider: RPCProvider): Promise<bigint | null> {
  const epInterface = new Interface(entryPointAbi)
  const failure = () => {
    // eslint-disable-next-line no-console
    console.error('inable to fetch the entry point nonce, estimateBundler')
    return null
  }
  const [accountNonceHexLatest, accountNonceHexPending] = await Promise.all([
    provider
      .call({
        to: ERC_4337_ENTRYPOINT,
        data: epInterface.encodeFunctionData('getNonce', [account.addr, 0]),
        blockTag: 'latest'
      })
      .catch(failure),
    provider
      .call({
        to: ERC_4337_ENTRYPOINT,
        data: epInterface.encodeFunctionData('getNonce', [account.addr, 0]),
        blockTag: 'pending'
      })
      .catch(failure)
  ])

  // if there's an RPC problem and we can't fetch the nonce, we return an error
  if (accountNonceHexLatest === null && accountNonceHexPending === null) return null
  if (accountNonceHexLatest === null) return BigInt(accountNonceHexPending as string) // shouldn't happen
  if (accountNonceHexPending === null) return BigInt(accountNonceHexLatest as string)

  const accountNonceLatest = BigInt(accountNonceHexLatest)
  const accountNoncePending = BigInt(accountNonceHexPending)

  // always trust latest except the time when pending is higher
  return accountNoncePending > accountNonceLatest ? accountNoncePending : accountNonceLatest
}
