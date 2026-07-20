import { toQuantity } from 'ethers'

import { ProviderError } from '../../classes/ProviderError'
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { getRpcProvider } from '../../services/provider'
import { getShouldStateOverride } from '../../utils/simulationStateOverride'
import { BaseAccount } from '../account/BaseAccount'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { getDiscoveredAssets, getFunctionParams, parseCallTracerResult } from './debugTraceCall'

const SIMULATION_BALANCE = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

interface EthSimulateV1Log {
  address: string
  topics?: string[]
}

interface EthSimulateV1Call {
  logs?: EthSimulateV1Log[]
}

interface EthSimulateV1Block {
  calls?: EthSimulateV1Call[]
}

export function parseEthSimulateV1Result(
  result: EthSimulateV1Block[] | undefined,
  callTo?: string | string[]
): {
  tokens: string[]
  nfts: [string, bigint[]][]
} {
  const callTargets = (Array.isArray(callTo) ? callTo : [callTo]).filter(Boolean) as string[]

  return parseCallTracerResult({
    calls: [
      ...callTargets.map((to) => ({ to })),
      ...(result?.flatMap((block) => block.calls?.map((call) => ({ logs: call.logs })) || []) || [])
    ]
  })
}

export function getEthSimulateV1Params(
  baseAcc: BaseAccount,
  op: AccountOp,
  network: Network,
  accountState: AccountOnchainState,
  overrideData?: any
): {
  callTargets: string[]
  params: [
    {
      blockStateCalls: {
        stateOverrides: any
        calls: { to?: string; value: string; data: string; from: string }[]
      }[]
      validation: false
    },
    'latest'
  ]
} | null {
  const account = baseAcc.getAccount()
  const shouldUseNativeBundle = op.calls.length > 1

  if (shouldUseNativeBundle) {
    const calls = getSignableCalls(op).map(([to, value, data]) => ({
      ...(to ? { to } : {}),
      value: toQuantity(value),
      data,
      from: op.accountAddr
    }))

    return {
      callTargets: getSignableCalls(op)
        .map(([to]) => to)
        .filter(Boolean) as string[],
      params: [
        {
          blockStateCalls: [
            {
              stateOverrides: {
                [op.accountAddr]: {
                  balance: SIMULATION_BALANCE
                }
              },
              calls
            }
          ],
          validation: false
        },
        'latest'
      ]
    }
  }

  const params = getFunctionParams(account, op, accountState)
  if (!params) return null

  const shouldUseStateOverrides = getShouldStateOverride(network, baseAcc) || !!overrideData

  return {
    callTargets: [params.to].filter(Boolean) as string[],
    params: [
      {
        blockStateCalls: [
          {
            stateOverrides: shouldUseStateOverrides
              ? {
                  [params.from]: {
                    balance: SIMULATION_BALANCE
                  },
                  ...overrideData
                }
              : {},
            calls: [
              {
                to: params.to,
                value: toQuantity(params.value.toString()),
                data: params.data,
                from: params.from
              }
            ]
          }
        ],
        validation: false
      },
      'latest'
    ]
  }
}

export async function ethSimulateV1(
  baseAcc: BaseAccount,
  op: AccountOp,
  network: Network,
  accountState: AccountOnchainState,
  overrideData?: any
): Promise<{ tokens: string[]; nfts: [string, bigint[]][] }> {
  const ethSimulateV1Params = getEthSimulateV1Params(
    baseAcc,
    op,
    network,
    accountState,
    overrideData
  )
  if (!ethSimulateV1Params) return { tokens: [], nfts: [] }

  const provider = getRpcProvider(network.rpcUrls, network.chainId, network.selectedRpcUrl)

  try {
    const response: EthSimulateV1Block[] = await provider.send(
      'eth_simulateV1',
      ethSimulateV1Params.params
    )

    const { tokens: foundTokens, nfts: foundNftTransfers } = parseEthSimulateV1Result(
      response,
      ethSimulateV1Params.callTargets
    )

    return await getDiscoveredAssets(
      provider,
      baseAcc,
      op,
      network,
      accountState,
      foundTokens,
      foundNftTransfers
    )
  } catch (e: any) {
    throw new ProviderError({ originalError: e, providerUrl: provider._getConnection()?.url })
  } finally {
    try {
      provider.destroy()
    } catch (e) {
      console.error(e)
    }
  }
}
