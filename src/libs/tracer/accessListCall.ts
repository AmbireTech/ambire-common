import { concat, getAddress, getBytes, Interface, solidityPacked, toQuantity } from 'ethers'

import { RPCProvider } from '@/interfaces/provider'
import { getFunctionParams } from '@/libs/tracer/debugTraceCall'

import SafeContract from '../../../contracts/compiled/Safe.json'
import { ProviderError } from '../../classes/ProviderError'
import { multiSendAddr, safeSimulateTxAccessor } from '../../consts/safe'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { getRpcProvider } from '../../services/provider'
import { BaseAccount } from '../account/BaseAccount'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'

const safeSimulateTxAccessorAbi = [
  'function simulate(address to, uint256 value, bytes data, uint8 operation)'
]
const multiSendAbi = ['function multiSend(bytes transactions)']
const safeIface = new Interface(SafeContract)
const simulateAccessorIface = new Interface(safeSimulateTxAccessorAbi)
const multiSendIface = new Interface(multiSendAbi)

const SAFE_CALL_OPERATION = 0
const SAFE_DELEGATE_CALL_OPERATION = 1

export function getSimulateTxnAccessor(version?: string): string | null {
  if (!version) return null

  if (version.startsWith('1.3')) return safeSimulateTxAccessor['v1.3.0']
  if (version.startsWith('1.4')) return safeSimulateTxAccessor['v1.4.1']
  if (version.startsWith('1.5')) return safeSimulateTxAccessor['v1.5.0']

  return null
}

export function getShouldUseAccessListCall(account: Account, needsStateOverride: boolean): boolean {
  // Use eth_createAccessList for Safe only if we know the
  // simulateTxAccessor for the Safe version (see getSafeAccessListCallParams)
  if (account.safeCreation) {
    return !!getSimulateTxnAccessor(account.safeCreation.version)
  }

  return !needsStateOverride
}

/**
 * We cannot use execTransaction for the access list call as it would require signatures for the transaction
 * (which we don't have at the point of simulation). Instead, we can use the simulate function of the SimulateTxAccessor contract,
 * which executes the transaction but reverts at the end, allowing us to trace it without needing signatures.
 *
 * The only downside is that there are multiple deployments of the contract, which is not that bad as we
 * can easily select the right one based on the Safe version and fall back to debug_traceCall if the version is not supported
 * All deployments: https://github.com/safe-global/safe-deployments/blob/main/src/deployments.ts
 */
export function getSafeAccessListCallParams(
  baseAcc: BaseAccount,
  op: AccountOp,
  accountState: AccountOnchainState
) {
  const account = baseAcc.getAccount()
  if (!account.safeCreation || !accountState.isDeployed) return null

  const signableCalls = getSignableCalls(op)
  if (!signableCalls.length) return null

  let to = signableCalls[0]![0]
  let value = BigInt(signableCalls[0]![1])
  let data = signableCalls[0]![2]
  let operation = SAFE_CALL_OPERATION

  if (signableCalls.length > 1) {
    const multiSendCalls = signableCalls.map((call) =>
      solidityPacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [SAFE_CALL_OPERATION, call[0], BigInt(call[1]), BigInt(getBytes(call[2]).length), call[2]]
      )
    )

    // For batched ops, Safe executes MultiSend via DELEGATECALL.
    to = multiSendAddr
    value = 0n
    data = multiSendIface.encodeFunctionData('multiSend', [concat(multiSendCalls)])
    operation = SAFE_DELEGATE_CALL_OPERATION
  }

  const simulateTxAccessor = getSimulateTxnAccessor(account.safeCreation.version)

  if (!simulateTxAccessor) return null

  const simulatePayload = simulateAccessorIface.encodeFunctionData('simulate', [
    to,
    value,
    data,
    operation
  ])

  const outerCalldata = safeIface.encodeFunctionData('simulateAndRevert', [
    simulateTxAccessor,
    simulatePayload
  ])

  return {
    to: account.addr,
    value: 0,
    data: outerCalldata,
    from: account.addr
  }
}

/**
 * Parses an access list and extracts unique contract addresses
 */
export function parseAccessList(
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

export async function sendCreateAccessList(
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
  const params =
    account.safeCreation && accountState.isDeployed
      ? getSafeAccessListCallParams(baseAcc, op, accountState)
      : getFunctionParams(account, op, accountState)

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
