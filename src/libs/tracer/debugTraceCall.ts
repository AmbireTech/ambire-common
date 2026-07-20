import { getAddress, Interface, keccak256, toQuantity, toUtf8Bytes } from 'ethers'

import { privSlot } from '@/libs/proxyDeploy/deploy'
import { getShouldStateOverride } from '@/utils/simulationStateOverride'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccount7702 from '../../../contracts/compiled/AmbireAccount7702.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import NFTGetter from '../../../contracts/compiled/NFTGetter.json'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { EOA_SIMULATION_NONCE } from '../../consts/deployless'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { getRpcProvider } from '../../services/provider'
import { getAccountDeployParams, getSpoof, isBasicAccount } from '../account/account'
import { BaseAccount } from '../account/BaseAccount'
import { AccountOp, callToTuple, getSignableCalls } from '../accountOp/accountOp'
import { DeploylessMode, fromDescriptor } from '../deployless/deployless'
import { getDeploylessOpts } from '../portfolio/getOnchainBalances'

const NFT_COLLECTION_LIMIT = 100
const ERC721_TRANSFER_TOPIC = keccak256(toUtf8Bytes('Transfer(address,address,uint256)'))

interface CallTracerLog {
  address: string
  topics?: string[]
}

interface CallTracerFrame {
  to?: string
  calls?: CallTracerFrame[]
  logs?: CallTracerLog[]
}

export function parseCallTracerResult(result: CallTracerFrame | undefined): {
  tokens: string[]
  nfts: [string, bigint[]][]
} {
  const tokenAddresses = new Set<string>()
  const nftTokenIdsByAddress = new Map<string, Set<bigint>>()

  const addTokenAddress = (address: string | undefined) => {
    if (!address) return

    tokenAddresses.add(getAddress(address))
  }

  const addNftTransfer = (log: CallTracerLog) => {
    if (
      log.topics?.length !== 4 ||
      log.topics[0]?.toLowerCase() !== ERC721_TRANSFER_TOPIC.toLowerCase()
    )
      return

    const address = getAddress(log.address)
    const tokenId = BigInt(log.topics[3]!)
    const tokenIds = nftTokenIdsByAddress.get(address) || new Set<bigint>()

    tokenIds.add(tokenId)
    nftTokenIdsByAddress.set(address, tokenIds)
  }

  const collectFrameAssets = (frame: CallTracerFrame | undefined) => {
    if (!frame) return

    addTokenAddress(frame.to)
    frame.logs?.forEach((log) => {
      addTokenAddress(log.address)
      addNftTransfer(log)
    })
    frame.calls?.forEach(collectFrameAssets)
  }

  collectFrameAssets(result)

  return {
    tokens: Array.from(tokenAddresses),
    nfts: Array.from(nftTokenIdsByAddress.entries()).map(([address, tokenIds]) => [
      address,
      Array.from(tokenIds)
    ])
  }
}

export function getStateOverride(
  account: Account,
  op: AccountOp,
  accountState: AccountOnchainState
) {
  // if the account is a Safe,
  // add an additional state override that gives privileges to the assKey;
  // also, we changed privs storage slot to ambire.smart.contracts.storage
  // so privs no longer override slot number 0
  const stateDiff = !!account.safeCreation
    ? {
        [privSlot(
          keccak256(toUtf8Bytes('ambire.smart.contracts.storage')),
          'uint256',
          account.associatedKeys[0],
          'bytes32'
        )]: '0x0000000000000000000000000000000000000000000000000000000000000002'
      }
    : undefined

  // add stateOverride when using a Safe as well
  const stateOverride =
    !!account.safeCreation || (op.calls.length > 1 && isBasicAccount(account, accountState))
      ? {
          [account.addr]: {
            code: AmbireAccount7702.binRuntime,
            stateDiff
          }
        }
      : undefined

  return stateOverride
}

// if using EOA, use the first and only call of the account op
// if it's SA, make the data execute or deployAndExecute,
// set the spoof+addr and pass all the calls
export function getFunctionParams(
  account: Account,
  op: AccountOp,
  accountState: AccountOnchainState
) {
  if (isBasicAccount(account, accountState) && op.calls.length === 1) {
    const call = op.calls[0]!
    return {
      to: call.to,
      value: toQuantity(call.value.toString()),
      data: call.data,
      from: op.accountAddr
    }
  }

  if (isBasicAccount(account, accountState)) {
    const saAbi = new Interface(AmbireAccount.abi)
    const callData = saAbi.encodeFunctionData('execute', [getSignableCalls(op), getSpoof(account)])
    return {
      to: account.addr,
      value: 0,
      data: callData,
      from: DEPLOYLESS_SIMULATION_FROM
    }
  }

  if (!!account.safeCreation && !accountState.isDeployed) return null

  const saAbi = new Interface(AmbireAccount.abi)
  const factoryAbi = new Interface(AmbireFactory.abi)
  const callData = accountState.isDeployed
    ? saAbi.encodeFunctionData('execute', [getSignableCalls(op), getSpoof(account)])
    : factoryAbi.encodeFunctionData('deployAndExecute', [
        account.creation!.bytecode,
        account.creation!.salt,
        getSignableCalls(op),
        getSpoof(account)
      ])

  return {
    from: DEPLOYLESS_SIMULATION_FROM,
    to: accountState.isDeployed ? account.addr : account.creation!.factoryAddr,
    value: 0,
    data: callData
  }
}

export async function getDiscoveredAssets(
  provider: RPCProvider,
  baseAcc: BaseAccount,
  op: AccountOp,
  network: Network,
  accountState: AccountOnchainState,
  foundTokens: string[],
  foundNftTransfers: [string, bigint[]][]
): Promise<{ tokens: string[]; nfts: [string, bigint[]][] }> {
  const account = baseAcc.getAccount()
  const opts = {
    blockTag: 'latest' as const,
    from: DEPLOYLESS_SIMULATION_FROM,
    mode: DeploylessMode.ProxyContract,
    isEOA: isBasicAccount(account, accountState),
    simulation: {
      accountOps: [op],
      baseAccount: baseAcc,
      state: accountState
    }
  }
  const deploylessOpts = getDeploylessOpts(account.addr, network, opts)
  const [factory, factoryCalldata] = getAccountDeployParams(account)
  const simulationOps = [
    [
      !isBasicAccount(account, accountState) ? op.nonce : BigInt(EOA_SIMULATION_NONCE),
      op.calls.map(callToTuple)
    ]
  ]

  // we set the 3rd param to "true" as we don't need state override
  const deploylessTokens = fromDescriptor(provider, BalanceGetter, true)
  const deploylessNfts = fromDescriptor(provider, NFTGetter, true)

  const getNftsPromise = deploylessNfts.call(
    'simulateAndGetAllNFTs',
    [
      op.accountAddr,
      account.associatedKeys,
      foundNftTransfers.map(([address]) => address),
      foundNftTransfers.map(([, x]) => x),
      NFT_COLLECTION_LIMIT,
      factory,
      factoryCalldata,
      simulationOps
    ],
    deploylessOpts
  )

  const result = await Promise.all([
    deploylessTokens.call('getBalances', [op.accountAddr, foundTokens], deploylessOpts),
    getNftsPromise
  ])

  const [[tokensWithErr], [before, after, , , , deltaAddressesMapping]] = result

  const beforeNftCollections = before.collections
  const afterNftCollections = after.collections

  return {
    tokens: foundTokens.filter((addr, i) => tokensWithErr[i].error === '0x'),
    nfts: foundNftTransfers.filter((nft, i) => {
      if (!beforeNftCollections[i][3] || beforeNftCollections[i][3] === '0x') return true
      const foundAfterToken = afterNftCollections.find(
        (t: any, j: number) =>
          deltaAddressesMapping[j].toLowerCase() === foundNftTransfers[i]![0].toLowerCase()
      )
      if (!foundAfterToken || !foundAfterToken[0]) return false

      return !foundAfterToken[i][3] || foundAfterToken[0][3] === '0x'
    })
  }
}

export async function debugTraceCall(
  baseAcc: BaseAccount,
  op: AccountOp,
  network: Network,
  accountState: AccountOnchainState,
  overrideData?: any
): Promise<{ tokens: string[]; nfts: [string, bigint[]][] }> {
  const account = baseAcc.getAccount()
  const opts = {
    blockTag: 'latest' as const,
    from: DEPLOYLESS_SIMULATION_FROM,
    mode: DeploylessMode.ProxyContract,
    isEOA: isBasicAccount(account, accountState),
    simulation: {
      accountOps: [op],
      baseAccount: baseAcc,
      state: accountState
    }
  }

  const params = getFunctionParams(account, op, accountState)

  // we throw on purpose here so the controller receives feedback that
  // debugTraceCall has actually failed
  if (!params) throw new Error('cannot run debug_traceCall as getFunctionParams is empty')

  // initialize a new provider for debug trace call to avoid batching it
  // as sometimes debug_traceCall gets handled really slowly from the RPCs
  // and that affects wallet performance
  const provider = getRpcProvider(network.rpcUrls, network.chainId, network.selectedRpcUrl)

  try {
    const trace: CallTracerFrame = await provider.send('debug_traceCall', [
      {
        to: params.to,
        value: toQuantity(params.value.toString()),
        data: params.data,
        from: params.from
      },
      'latest',
      {
        // we're replacing the custom tracer with the built-in callTracer
        // because it has broader RPC support. The trade off is that the
        // data we're pulling from the RPC is a bit bigger compared to the
        // custom tracer. But at least it works broadly as networks like Base
        // that use geth only don't support custom tracers, resulting in
        // bad discovery
        tracer: 'callTracer',
        tracerConfig: {
          withLog: true
        },
        stateOverrides: getShouldStateOverride(network, opts.simulation.baseAccount)
          ? {
              [params.from]: {
                balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
              },
              ...overrideData
            }
          : {}
      }
    ])

    const { tokens: foundTokens, nfts: foundNftTransfers } = parseCallTracerResult(trace)

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
    // we do this so we could run finally
    throw e
  } finally {
    // clean up the provider after usage
    try {
      provider.destroy()
    } catch (e) {
      console.error(e)
    }
  }
}
