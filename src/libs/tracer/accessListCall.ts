import { getAddress, toQuantity } from 'ethers'

import { RPCProvider } from '@/interfaces/provider'
import { getFunctionParams } from '@/libs/tracer/debugTraceCall'

import { ProviderError } from '../../classes/ProviderError'
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { getRpcProvider } from '../../services/provider'
import { BaseAccount } from '../account/BaseAccount'
import { AccountOp } from '../accountOp/accountOp'

/**
 * Parses an access list and extracts unique contract addresses
 */
function parseAccessList(
  accessList: Array<{ address: string; storageKeys: string[] }> | undefined
): string[] {
  if (!accessList || accessList.length === 0) {
    return []
  }

  // Extract and deduplicate addresses
  const uniqueAddresses = new Set<string>()

  accessList.forEach(({ address }) => {
    try {
      // Normalize the address using getAddress (checksum)
      const normalized = getAddress(address)
      uniqueAddresses.add(normalized)
    } catch (e) {
      // Skip invalid addresses
    }
  })

  return Array.from(uniqueAddresses)
}

/**
 * eth_createAccessList RPC response structure
 */
interface CreateAccessListResponse {
  accessList: Array<{ address: string; storageKeys: string[] }>
  gasUsed: string
}

async function sendCreateAccessList(
  provider: RPCProvider,
  params: { to: string; value: number | string; data: string; from: string },
  network: Network,
  /**
   * State override was added in 2025 but is not yet widely supported, so it shouldn't be used
   * https://github.com/ethereum/go-ethereum/issues/27630
   */
  stateOverride?: any
) {
  if (stateOverride) {
    console.error(
      'Debug: Attempting to use state override with eth_createAccessList, which may not be supported by all RPC providers'
    )
  }

  const requestParams: any[] = [
    {
      to: params.to,
      value: toQuantity(params.value.toString()),
      data: params.data,
      from: params.from
    },
    'latest'
  ]

  if (!network.rpcNoStateOverride && stateOverride) {
    try {
      return await provider.send('eth_createAccessList', [
        ...requestParams,
        {
          ...stateOverride,
          [params.from]: {
            balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
            ...(stateOverride[params.from] || {})
          }
        }
      ])
    } catch (e) {
      // Fall back to standard two-param call for RPCs that reject state override on eth_createAccessList.
    }
  }

  return provider.send('eth_createAccessList', requestParams)
}

/**
 * Uses eth_createAccessList to discover contract addresses accessed during transaction execution.
 * Traces all calls in the AccountOp and merges the discovered addresses.
 */
export async function createAccessListCall(
  baseAcc: BaseAccount,
  op: AccountOp,
  network: Network,
  accountState: AccountOnchainState
): Promise<string[]> {
  const account = baseAcc.getAccount()
  const params = getFunctionParams(account, op, accountState)

  if (!params) return []

  // Initialize a new provider for eth_createAccessList
  // Using separate provider to avoid batching issues that can impact performance
  const provider = getRpcProvider(network.rpcUrls, network.chainId, network.selectedRpcUrl)

  try {
    const response = await sendCreateAccessList(provider, params, network)

    const returned = parseAccessList((response as CreateAccessListResponse).accessList)

    return returned
  } catch (e: any) {
    console.error('Debug: eth_createAccessList error', e)
    // eslint-disable-next-line no-underscore-dangle
    throw new ProviderError({ originalError: e, providerUrl: provider._getConnection()?.url })
  } finally {
    // Clean up the provider after usage
    try {
      provider.destroy()
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e)
    }
  }
}
