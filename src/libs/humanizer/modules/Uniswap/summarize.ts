import { Hex } from 'viem'

import { networks } from '../../../../consts/networks'
import { AccountOp } from '../../../accountOp/accountOp'
import { HexIrCall } from '../../utils'
import { DescribeUnknownCall, decodeLegacyCall } from './decodeLegacyRouters'
import { decodeUniversalRouter } from './decodeUniversalRouter'
import { Effect, UniswapContext } from './effects'
import { buildOutcome } from './ledger'
import { UniswapSummary, renderOutcome } from './render'

const getContext = (accountOp: AccountOp, call: HexIrCall): UniswapContext => {
  if (!call.to) throw Error('Humanizer: should not be inside the uniswap module when !call.to')

  return {
    accountAddr: accountOp.accountAddr.toLowerCase(),
    routerAddr: call.to.toLowerCase(),
    callValue: BigInt(call.value),
    chainId: accountOp.chainId,
    wrappedNative: networks
      .find((network) => network.chainId === accountOp.chainId)
      ?.wrappedAddr?.toLowerCase()
  }
}

/**
 * Describes the commands of a Universal Router (`commands`, `inputs` and `deadline`). It is used by
 * the router itself and by the contracts that forward calls to it with the same encoding (for
 * example SwapProxy).
 */
export const summarizeUniversalRouterCommands = (
  commands: Hex,
  inputs: readonly Hex[],
  deadline: bigint,
  accountOp: AccountOp,
  call: HexIrCall,
  effectsBefore: Effect[] = []
): UniswapSummary => {
  const ctx = getContext(accountOp, call)
  return renderOutcome(
    buildOutcome(decodeUniversalRouter(commands, inputs, ctx, effectsBefore), ctx),
    ctx,
    deadline
  )
}

/**
 * Describes a call to one of the older routers, or returns `undefined` when the call is not a
 * swap, a payment or a multicall.
 */
export const summarizeLegacyRouterCall = (
  accountOp: AccountOp,
  call: HexIrCall,
  describeUnknownCall: DescribeUnknownCall
): UniswapSummary | undefined => {
  const ctx = getContext(accountOp, call)
  const decoded = decodeLegacyCall(call.data, ctx, describeUnknownCall)
  if (!decoded) return undefined

  return renderOutcome(buildOutcome(decoded.effects, ctx), ctx, decoded.deadline)
}
