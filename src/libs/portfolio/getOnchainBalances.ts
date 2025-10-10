import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { EOA_SIMULATION_NONCE } from '../../consts/deployless'
import { Network } from '../../interfaces/network'
/* eslint-disable no-console */
import { yieldToMain } from '../../utils/scheduler'
import { getEoaSimulationStateOverride } from '../../utils/simulationStateOverride'
import { getAccountDeployParams, shouldUseStateOverrideForEOA } from '../account/account'
import { callToTuple, toSingletonCall } from '../accountOp/accountOp'
import { Deployless, DeploylessMode } from '../deployless/deployless'
/* eslint-disable import/no-cycle */
import { decodeError } from '../errorDecoder'
import { DEPLOYLESS_ERRORS } from '../errorHumanizer/errors'
import { getHumanReadableErrorMessage } from '../errorHumanizer/helpers'
import { mapToken } from './helpers'
import {
  CollectionResult,
  GetOptions,
  LimitsOptions,
  MetaData,
  TokenError,
  TokenResult
} from './interfaces'

class SimulationError extends Error {
  public simulationErrorMsg: string

  public beforeNonce: bigint

  public afterNonce: bigint

  constructor(message: string, beforeNonce: bigint, afterNonce: bigint) {
    super(`simulation error: ${message}`)
    this.simulationErrorMsg = message
    this.beforeNonce = beforeNonce
    this.afterNonce = afterNonce
    console.error('simulation error: ', {
      beforeNonce,
      afterNonce,
      message
    })
  }
}

function handleSimulationError(
  errorData: string,
  beforeNonce: bigint,
  afterNonce: bigint,
  simulationOps: { nonce: bigint | null; calls: [string, string, string][] }[]
) {
  if (errorData !== '0x') {
    const error = new Error(errorData)
    const decodedError = decodeError(error)
    const humanizedError = getHumanReadableErrorMessage(
      null,
      DEPLOYLESS_ERRORS,
      'Transaction cannot be simulated because',
      decodedError,
      error
    )
    const fallbackMessage = `Transaction cannot be simulated because of an unknown error. Error code: ${
      decodedError.reason || errorData.slice(0, 10)
    }`

    throw new SimulationError(humanizedError || fallbackMessage, beforeNonce, afterNonce)
  }

  // If the afterNonce is 0, it means that we reverted, even if the error is empty
  // In both BalanceOracle and NFTOracle, afterSimulation and therefore afterNonce will be left empty
  if (afterNonce === 0n) throw new SimulationError('Simulation reverted', beforeNonce, afterNonce)

  if (afterNonce < beforeNonce)
    throw new SimulationError(
      'lower "after" nonce, should not be possible',
      beforeNonce,
      afterNonce
    )
  if (simulationOps.length && afterNonce === beforeNonce)
    throw new SimulationError(
      'Account op passed for simulation but the nonce did not increment. Perhaps wrong nonce set in Account op',
      beforeNonce,
      afterNonce
    )

  // make sure the afterNonce (after all the accOps execution) is
  // at least the same as the final nonce in the simulationOps
  const nonces: bigint[] = simulationOps
    .map((op) => op.nonce ?? -1n)
    .filter((nonce) => nonce !== -1n)
    .sort((a, b) => {
      if (a === b) return 0
      if (a > b) return 1
      return -1
    })
  if (nonces.length && afterNonce < nonces[nonces.length - 1] + 1n) {
    throw new SimulationError(
      'Failed to increment the nonce to the final account op nonce',
      beforeNonce,
      afterNonce
    )
  }
}

export function getDeploylessOpts(
  accountAddr: string,
  supportsStateOverride: boolean,
  opts: Pick<GetOptions, 'simulation' | 'blockTag'>
) {
  const hasEOAOverride =
    opts.simulation && shouldUseStateOverrideForEOA(opts.simulation.account, opts.simulation.state)

  return {
    blockTag: opts.blockTag,
    from: DEPLOYLESS_SIMULATION_FROM,
    mode:
      supportsStateOverride && hasEOAOverride
        ? DeploylessMode.StateOverride
        : DeploylessMode.Detect,
    stateToOverride:
      supportsStateOverride && hasEOAOverride ? getEoaSimulationStateOverride(accountAddr) : null
  }
}

export async function getNFTs(
  network: Network,
  deployless: Deployless,
  opts: Pick<GetOptions, 'simulation' | 'blockTag'>,
  accountAddr: string,
  tokenAddrs: [string, bigint[]][],
  limits: LimitsOptions
): Promise<[[TokenError, CollectionResult][], {}][]> {
  const deploylessOpts = getDeploylessOpts(accountAddr, !network.rpcNoStateOverride, opts)
  const mapToken = (token: any) => {
    return {
      name: token.name,
      chainId: network.chainId,
      symbol: token.symbol,
      amount: BigInt(token.nfts.length),
      decimals: 1,
      collectibles: [...token.nfts]
    } as CollectionResult
  }

  if (!opts.simulation) {
    const collections = await deployless.call(
      'getAllNFTs',
      [
        accountAddr,
        tokenAddrs.map(([address]) => address),
        tokenAddrs.map(([, ids]) => ids.slice(0, limits.erc721TokensInput)),
        limits.erc721Tokens
      ],
      deploylessOpts
    )

    return [collections.map((token: any) => [token.error, mapToken(token)]), {}]
  }

  const { accountOps, account, state } = opts.simulation
  const [factory, factoryCalldata] = getAccountDeployParams(account)

  const simulationOps = accountOps.map(({ nonce, calls }, idx) => ({
    // EOA starts from a fake, specified nonce
    nonce: !shouldUseStateOverrideForEOA(account, state)
      ? nonce
      : BigInt(EOA_SIMULATION_NONCE) + BigInt(idx),
    calls: calls.map(toSingletonCall).map(callToTuple)
  }))
  const [before, after, simulationErr, , , deltaAddressesMapping] = await deployless.call(
    'simulateAndGetAllNFTs',
    [
      accountAddr,
      account.associatedKeys,
      tokenAddrs.map(([address]) => address),
      tokenAddrs.map(([, ids]) => ids.slice(0, limits.erc721TokensInput)),
      limits.erc721Tokens,
      factory,
      factoryCalldata,
      simulationOps.map((op) => Object.values(op))
    ],
    deploylessOpts
  )

  const beforeNonce = before.nonce
  const afterNonce = after.nonce
  handleSimulationError(simulationErr, beforeNonce, afterNonce, simulationOps)

  // simulation was performed if the nonce is changed
  const hasSimulation = afterNonce !== beforeNonce

  const simulationTokens: (CollectionResult & { addr: any })[] | null = hasSimulation
    ? after.collections.map((simulationToken: any, tokenIndex: number) => ({
        ...mapToken(simulationToken),
        addr: deltaAddressesMapping[tokenIndex]
      }))
    : null

  return [
    before.collections.map((beforeToken: any, i: number) => {
      const simulationToken = simulationTokens
        ? simulationTokens.find(
            (token: any) => token.addr.toLowerCase() === tokenAddrs[i][0].toLowerCase()
          )
        : null

      const token = mapToken(beforeToken)
      const receiving: bigint[] = []
      const sending: bigint[] = []

      token.collectibles.forEach((oldCollectible: bigint) => {
        // the first check is required because if there are no changes we will always have !undefined from the second check
        if (
          simulationToken?.collectibles &&
          !simulationToken?.collectibles?.includes(oldCollectible)
        )
          sending.push(oldCollectible)
      })
      simulationToken?.collectibles?.forEach((newCollectible: bigint) => {
        if (!token.collectibles.includes(newCollectible)) receiving.push(newCollectible)
      })

      return [
        beforeToken.error,
        {
          ...token,
          // Please refer to getTokens() for more info regarding `amountBeforeSimulation` calc
          simulationAmount: simulationToken ? simulationToken.amount - token.amount : undefined,
          amountPostSimulation: simulationToken ? simulationToken.amount : token.amount,
          postSimulation: { receiving, sending }
        }
      ]
    }),
    {}
  ]
}

export async function getTokens(
  network: Network,
  deployless: Deployless,
  opts: Pick<GetOptions, 'simulation' | 'blockTag' | 'specialErc20Hints'>,
  accountAddr: string,
  tokenAddrs: string[],
  pageIndex?: number
): Promise<[[TokenError, TokenResult][], MetaData][]> {
  if (typeof pageIndex === 'number' && pageIndex > 0) {
    // Allow the main thread to process other tasks before continuing
    // as encode/decode operations (in deployless) are very CPU intensive
    await yieldToMain()
  }

  const deploylessOpts = getDeploylessOpts(accountAddr, !network.rpcNoStateOverride, opts)
  if (!opts.simulation) {
    const [results, blockNumber] = await deployless.call(
      'getBalances',
      [accountAddr, tokenAddrs],
      deploylessOpts
    )

    return [
      results.map((token: any, i: number) => [
        token.error,
        mapToken(token, network, tokenAddrs[i], opts)
      ]),
      {
        blockNumber
      }
    ]
  }
  const { accountOps, account, state } = opts.simulation
  const simulationOps = accountOps.map(({ nonce, calls }, idx) => ({
    // EOA starts from a fake, specified nonce
    nonce: !shouldUseStateOverrideForEOA(account, state)
      ? nonce
      : BigInt(EOA_SIMULATION_NONCE) + BigInt(idx),
    calls: calls.map(toSingletonCall).map(callToTuple)
  }))
  const [factory, factoryCalldata] = getAccountDeployParams(account)
  const [before, after, simulationErr, , blockNumber, deltaAddressesMapping] =
    await deployless.call(
      'simulateAndGetBalances',
      [
        accountAddr,
        account.associatedKeys,
        tokenAddrs,
        factory,
        factoryCalldata,
        simulationOps.map((op) => Object.values(op))
      ],
      deploylessOpts
    )

  const beforeNonce = before.nonce
  const afterNonce = after.nonce
  handleSimulationError(simulationErr, beforeNonce, afterNonce, simulationOps)

  // simulation was performed if the nonce is changed
  const hasSimulation = afterNonce !== beforeNonce

  const simulationTokens = hasSimulation
    ? after.balances.map((simulationToken: any, tokenIndex: number) => ({
        ...simulationToken,
        amount: simulationToken.amount,
        addr: deltaAddressesMapping[tokenIndex]
      }))
    : null
  return [
    before.balances.map((token: any, i: number) => {
      const simulation = simulationTokens
        ? simulationTokens.find((simulationToken: any) => simulationToken.addr === tokenAddrs[i])
        : null

      // Here's the math before `simulationAmount` and `amountPostSimulation`.
      // AccountA initial balance: 10 USDC.
      // AccountA attempts to transfer 5 USDC (not signed yet).
      // An external entity sends 3 USDC to AccountA on-chain.
      // Deployless simulation contract processing:
      //   - Balance before simulation (before.balances): 10 USDC + 3 USDC = 13 USDC.
      //   - Balance after simulation (after.balances): 10 USDC - 5 USDC + 3 USDC = 8 USDC.
      // Simulation-only balance displayed on the Sign Screen (we will call it `simulationAmount`):
      //   - difference between after simulation and before: 8 USDC - 13 USDC = -5 USDC
      // Final balance displayed on the Dashboard (we will call it `amountPostSimulation`):
      //   - after.balances, 8 USDC.
      return [
        token.error,
        {
          ...mapToken(token, network, tokenAddrs[i], opts),
          simulationAmount: simulation ? simulation.amount - token.amount : undefined,
          amountPostSimulation: simulation ? simulation.amount : token.amount
        }
      ]
    }),
    {
      blockNumber,
      beforeNonce,
      afterNonce
    }
  ]
}
