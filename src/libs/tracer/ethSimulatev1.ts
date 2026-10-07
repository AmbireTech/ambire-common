import { toQuantity } from 'ethers'

import { ProviderError } from '../../classes/ProviderError'
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { getRpcProvider } from '../../services/provider'
import { BaseAccount } from '../account/BaseAccount'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { getDiscoveredAssets, parseCallTracerResult } from './debugTraceCall'

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

export function getEthSimulateV1Params(op: AccountOp): {
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

export async function ethSimulateV1(
  baseAcc: BaseAccount,
  op: AccountOp,
  network: Network,
  accountState: AccountOnchainState
): Promise<{ tokens: string[]; nfts: [string, bigint[]][] }> {
  const ethSimulateV1Params = getEthSimulateV1Params(op)
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
