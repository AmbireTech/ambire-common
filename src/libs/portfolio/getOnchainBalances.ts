import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getAccountDeployParams, isSmartAccount } from '../account/account'
import { callToTuple } from '../accountOp/accountOp'
import { Deployless, DeploylessMode, parseErr } from '../deployless/deployless'
import { privSlot } from '../proxyDeploy/deploy'
import { getFlags } from './helpers'
import { Collectible, CollectionResult, GetOptions, LimitsOptions, TokenResult } from './interfaces'

// 0x00..01 is the address from which simulation signatures are valid
const DEPLOYLESS_SIMULATION_FROM = '0x0000000000000000000000000000000000000001'

class SimulationError extends Error {
  public simulationErrorMsg: string

  public beforeNonce: bigint

  public afterNonce: bigint

  constructor(message: string, beforeNonce: bigint, afterNonce: bigint) {
    super(`simulation error: ${message}`)
    this.simulationErrorMsg = message
    this.beforeNonce = beforeNonce
    this.afterNonce = afterNonce
  }
}

function handleSimulationError(error: string, beforeNonce: bigint, afterNonce: bigint) {
  if (error !== '0x') throw new SimulationError(parseErr(error) || error, beforeNonce, afterNonce)
  // If the afterNonce is 0, it means that we reverted, even if the error is empty
  // In both BalanceOracle and NFTOracle, afterSimulation and therefore afterNonce will be left empty
  if (afterNonce === 0n)
    throw new SimulationError('unknown error: simulation reverted', beforeNonce, afterNonce)
  if (afterNonce < beforeNonce)
    throw new SimulationError(
      'lower "after" nonce, should not be possible',
      beforeNonce,
      afterNonce
    )
}

function getDeploylessOpts(accountAddr: string, opts: Partial<GetOptions>) {
  return {
    blockTag: opts.blockTag,
    from: DEPLOYLESS_SIMULATION_FROM,
    mode: opts.isEOA ? DeploylessMode.StateOverride : DeploylessMode.Detect,
    stateToOverride: opts.isEOA
      ? {
          [accountAddr]: {
            code: AmbireAccount.binRuntime,
            stateDiff: {
              // if we use 0x00...01 we get a geth bug: "invalid argument 2: hex number with leading zero digits\" - on some RPC providers
              [`0x${privSlot(0, 'address', accountAddr, 'bytes32')}`]:
                '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
            }
          }
        }
      : null
  }
}

export async function getNFTs(
  network: NetworkDescriptor,
  deployless: Deployless,
  opts: Partial<GetOptions>,
  accountAddr: string,
  tokenAddrs: [string, any][],
  limits: LimitsOptions
): Promise<[number, CollectionResult][]> {
  const deploylessOpts = getDeploylessOpts(accountAddr, opts)
  const mapToken = (token: any) => {
    return {
      name: token.name,
      networkId: network.id,
      symbol: token.symbol,
      amount: BigInt(token.nfts.length),
      decimals: 1,
      collectibles: [...(token.nfts as any[])].map(
        (colToken: any) => ({ id: colToken.id, url: colToken.uri } as Collectible)
      )
    } as CollectionResult
  }

  if (!opts.simulation) {
    const collections = (
      await deployless.call(
        'getAllNFTs',
        [
          accountAddr,
          tokenAddrs.map(([address]) => address),
          tokenAddrs.map(([, x]) =>
            x.enumerable ? [] : x.tokens.slice(0, limits.erc721TokensInput)
          ),
          limits.erc721Tokens
        ],
        deploylessOpts
      )
    )[0]

    return collections.map((token: any) => [token.error, mapToken(token)])
  }

  const { accountOps, account } = opts.simulation
  const [factory, factoryCalldata] = getAccountDeployParams(account)

  const [before, after, simulationErr] = await deployless.call(
    'simulateAndGetAllNFTs',
    [
      accountAddr,
      account.associatedKeys,
      tokenAddrs.map(([address]) => address),
      tokenAddrs.map(([, x]) => (x.enumerable ? [] : x.tokens.slice(0, limits.erc721TokensInput))),
      limits.erc721Tokens,
      factory,
      factoryCalldata,
      accountOps.map(({ nonce, calls }) => [nonce, calls.map(callToTuple)])
    ],
    deploylessOpts
  )

  const beforeNonce = before[1]
  const afterNonce = after[1]
  handleSimulationError(simulationErr, beforeNonce, afterNonce)

  // no simulation was performed if the nonce is the same
  const postSimulationAmounts = (after[1] === before[1] ? before[0] : after[0]).map(mapToken)

  return before[0].map((token: any, i: number) => [
    token.error,
    { ...mapToken(token), amountPostSimulation: postSimulationAmounts[i].amount }
  ])
}

export async function getTokens(
  network: NetworkDescriptor,
  deployless: Deployless,
  opts: Partial<GetOptions>,
  accountAddr: string,
  tokenAddrs: string[]
): Promise<[number, TokenResult][]> {
  const mapToken = (token: any, address: string) =>
    ({
      amount: token.amount,
      networkId: network.id,
      decimals: Number(token.decimals),
      symbol:
        address === '0x0000000000000000000000000000000000000000'
          ? network.nativeAssetSymbol
          : token.symbol,
      address,
      flags: getFlags({}, network.id, network.id, address)
    } as TokenResult)
  const deploylessOpts = getDeploylessOpts(accountAddr, opts)
  if (!opts.simulation) {
    const [results] = await deployless.call(
      'getBalances',
      [accountAddr, tokenAddrs],
      deploylessOpts
    )

    return results.map((token: any, i: number) => [token.error, mapToken(token, tokenAddrs[i])])
  }
  const { accountOps, account } = opts.simulation
  const [factory, factoryCalldata] = getAccountDeployParams(account)
  const [before, after, simulationErr] = await deployless.call(
    'simulateAndGetBalances',
    [
      accountAddr,
      account.associatedKeys,
      tokenAddrs,
      factory,
      factoryCalldata,
      accountOps.map(({ nonce, calls }, index) => [
        isSmartAccount(account) ? nonce : BigInt(index), // EOA simulation always starts from 0
        calls.map(callToTuple)
      ])
    ],
    deploylessOpts
  )

  const beforeNonce = before[1]
  const afterNonce = after[1]
  handleSimulationError(simulationErr, beforeNonce, afterNonce)

  // no simulation was performed if the nonce is the same
  const postSimulationAmounts = afterNonce === beforeNonce ? before[0] : after[0]

  return before[0].map((token: any, i: number) => [
    token.error,
    { ...mapToken(token, tokenAddrs[i]), amountPostSimulation: postSimulationAmounts[i].amount }
  ])
}
