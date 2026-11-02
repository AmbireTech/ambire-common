import {
  decodeAbiParameters,
  decodeFunctionData,
  parseAbi,
  parseAbiParameters,
  toFunctionSelector,
  zeroAddress,
  type AbiParameter,
  type Hex
} from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualization, IrCall } from '../../interfaces'
import {
  HexIrCall,
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken,
  getWrapping
} from '../../utils'
import {
  COMMANDS,
  COMMANDS_DESCRIPTIONS,
  V4_ACTION_CODES,
  V4_ACTION_DESCRIPTORS,
  V4_SWAP_ACTION_DESCRIPTORS_WITH_MIN_HOP_PRICE
} from './Commands'
import { HumanizerUniMatcher } from './interfaces'
import {
  getUniRecipientText,
  getUniversalRouterRecipientText,
  isOwnOrRouterRecipient,
  isUniswapFeeRecipient,
  parsePath,
  UNIVERSAL_ROUTER_MSG_SENDER,
  uniReduce
} from './utils'
import { AbiCoder } from 'ethers'

const coder = new AbiCoder()

// 100 basis points = 1%. Fees up to this share that are paid with PAY_PORTION are not displayed.
const MAX_HIDDEN_PAY_PORTION_BIPS = 100n
const extractParams = (inputsDetails: any, input: any) => {
  const types = inputsDetails.map((i: any) => i.type)
  const decodedInput = coder.decode(types, input)
  const params: any = {}
  inputsDetails.forEach((item: any, index: number) => {
    params[item.name] = decodedInput[index]
  })

  return params
}

// The V2_SWAP_EXACT_IN encoding of the routers that have a `bool isUni` flag
const ALTERNATIVE_V2_SWAP_EXACT_IN_INPUTS_DETAILS = [
  { type: 'address', name: 'user' },
  { type: 'uint256', name: 'amountIn' },
  { type: 'uint256', name: 'amountOut' },
  { type: 'bytes', name: 'path' },
  { type: 'bool', name: 'isUserPayer' },
  { type: 'bool', name: 'isUni' }
]

// this function splits uniswap commands from single hex string to multiple hex strings
// '0x1234' => ['0x12', '0x34']
function parseCommands(commands: string): string[] | null {
  // all commands are 1 byte = 2 hex chars
  if (commands.length % 2) return null
  if (!/^0x[0-9A-Fa-f]+$/.test(commands)) return null
  const res: string[] = []
  // iterate over pairs of chars
  for (let i = 2; i < commands.length; i += 2) {
    res.push(`0x${commands.slice(i, i + 2)}`)
  }
  return res
}

// In the alternative V2_SWAP_EXACT_IN encoding a multi-hop swap is one command per hop (the
// earlier hops can be V3 swaps). A hop sends its output to the pool of the next hop, and the next
// hop is not paid by the signer, so the recipient of such a hop is not the final destination of
// the funds. The last hop is.
function isFeedingNextAlternativeSwap(
  parsedCommands: string[],
  inputs: readonly Hex[],
  index: number,
  tokenOut: string
): boolean {
  const nextInput = inputs[index + 1]
  if (parsedCommands[index + 1] !== COMMANDS.V2_SWAP_EXACT_IN || !nextInput) return false

  // the next command must be in the alternative encoding too, which is when the standard one fails
  try {
    extractParams(COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_IN.inputsDetails, nextInput)
    return false
  } catch {
    // not an error: this is how the alternative encoding is detected
  }

  try {
    const next = extractParams(ALTERNATIVE_V2_SWAP_EXACT_IN_INPUTS_DETAILS, nextInput)
    return !next.isUserPayer && next.path.slice(0, 42).toLowerCase() === tokenOut.toLowerCase()
  } catch {
    // the next command can't be decoded, so it is not known to continue this swap
    return false
  }
}

// The swap parameters of the V4 router got a new field (`minHopPriceX36`) in its newer versions.
// They are decoded with the original layout first, and with the new layout when that does not fit.
// The fields that are read after this are in the same place in both layouts.
function extractV4SwapParams(
  swapAction: keyof typeof V4_SWAP_ACTION_DESCRIPTORS_WITH_MIN_HOP_PRICE,
  param: Hex
) {
  try {
    const { swap } = extractParams(V4_ACTION_DESCRIPTORS[swapAction], param)
    // ethers does not throw for a field that does not fit while decoding, it throws when it is read
    swap.toArray(true)
    return swap
  } catch {
    // not an error: the parameters are not in the original layout, so the new one is used. When
    // they are not in the new one either, the decoding below throws.
  }
  return extractParams(V4_SWAP_ACTION_DESCRIPTORS_WITH_MIN_HOP_PRICE[swapAction], param).swap
}

function parseV4Actions(
  actions: string,
  totalParams: Hex[],
  accountAddr: string,
  routerAddr: string
): HumanizerVisualization[] {
  const parsedActions = parseCommands(actions)
  const parsed: HumanizerVisualization[][] = []
  if (!parsedActions) return [getAction('Unknown Uniswap V4 action')]
  if (parsedActions.length !== totalParams.length) return [getAction('Unknown Uniswap V4 action')]
  const zippedData = parsedActions.map((_, i) => ({
    action: parsedActions[i],
    param: totalParams[i]
  }))
  zippedData.forEach(({ action, param }) => {
    if (action === V4_ACTION_CODES.SETTLE) {
      const args = extractParams(V4_ACTION_DESCRIPTORS.SETTLE, param)
      parsed.push([getAction('Send'), getToken(args.currency, args.amount)])
    } else if (action === V4_ACTION_CODES.SETTLE_ALL) {
      const args = extractParams(V4_ACTION_DESCRIPTORS.SETTLE_ALL, param)
      parsed.push([getAction('Send'), getToken(args.currency, args.maxAmount)])
    } else if (action === V4_ACTION_CODES.SWAP_EXACT_IN) {
      const [tokenIn, path] = extractV4SwapParams('SWAP_EXACT_IN', param)
      const lastToken = path[path.length - 1][0]

      parsed.push([
        getAction('Swap'),
        getToken(tokenIn, 0n),
        getLabel('for'),
        getToken(lastToken, 0n)
      ])
    } else if (action === V4_ACTION_CODES.SWAP_EXACT_OUT) {
      const [tokenOut, path] = extractV4SwapParams('SWAP_EXACT_OUT', param)
      const firstToken = path[0][0]

      parsed.push([
        getAction('Swap'),
        getToken(firstToken, 0n),
        getLabel('for'),
        getToken(tokenOut, 0n)
      ])
    } else if (action === V4_ACTION_CODES.SWAP_EXACT_IN_SINGLE) {
      const [poolKey, zeroForOne] = extractV4SwapParams('SWAP_EXACT_IN_SINGLE', param)
      const [currency0, currency1] = poolKey
      // the direction of the swap: from currency0 to currency1 when `zeroForOne` is true
      const [tokenIn, tokenOut] = zeroForOne ? [currency0, currency1] : [currency1, currency0]

      parsed.push([
        getAction('Swap'),
        getToken(tokenIn, 0n),
        getLabel('for'),
        getToken(tokenOut, 0n)
      ])
    } else if (action === V4_ACTION_CODES.SWAP_EXACT_OUT_SINGLE) {
      const [poolKey, zeroForOne] = extractV4SwapParams('SWAP_EXACT_OUT_SINGLE', param)
      const [currency0, currency1] = poolKey
      // the direction of the swap: from currency0 to currency1 when `zeroForOne` is true
      const [tokenIn, tokenOut] = zeroForOne ? [currency0, currency1] : [currency1, currency0]

      parsed.push([
        getAction('Swap'),
        getToken(tokenIn, 0n),
        getLabel('for'),
        getToken(tokenOut, 0n)
      ])
    } else if (action === V4_ACTION_CODES.TAKE) {
      const args = extractParams(V4_ACTION_DESCRIPTORS.TAKE, param)
      if (isOwnOrRouterRecipient(accountAddr, args.recipient, routerAddr)) {
        if (args.amount) parsed.push([getAction('Take'), getToken(args.currency, args.amount)])
      } else {
        // a zero amount is not "nothing": it takes everything the swaps left to be taken
        parsed.push([
          getAction('Send'),
          getToken(args.currency, args.amount),
          getLabel('to'),
          getAddressVisualization(args.recipient)
        ])
      }
    } else if (action === V4_ACTION_CODES.TAKE_ALL) {
      const args = extractParams(V4_ACTION_DESCRIPTORS.TAKE_ALL, param)
      parsed.push([getAction('Take'), getToken(args.currency, args.minAmount)])
    } else if (action === V4_ACTION_CODES.TAKE_PORTION) {
      const args = extractParams(V4_ACTION_DESCRIPTORS.TAKE_PORTION, param)
      if (!isOwnOrRouterRecipient(accountAddr, args.recipient, routerAddr)) {
        parsed.push([
          getAction('Send'),
          getLabel(`${(Number(args.bips) / 100).toFixed(0)}%`, true),
          getToken(args.currency, 0n),
          getLabel('to'),
          getAddressVisualization(args.recipient)
        ])
      }
    } else {
      parsed.push([getAction('Unknown uniswap V4 action')])
    }
  })
  return uniReduce(parsed)
}

const executeWithDeadlineAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'
])

// Decodes Uniswap Universal Router `commands`/`inputs`/`deadline` into a humanized visualization.
// Shared by the Universal Router's own `execute` entrypoint and by other contracts (e.g. SwapProxy)
// that forward calls to the Universal Router using the same command encoding.
export const humanizeUniversalRouterCommands = (
  commands: Hex,
  inputs: readonly Hex[],
  deadline: bigint,
  accountOp: AccountOp,
  call: HexIrCall
): HumanizerVisualization[] => {
  if (!call.to) throw Error('Humanizer: should not be inside the uniswap module when !call.to')
  const parsedCommands = parseCommands(commands)
  const parsed: HumanizerVisualization[][] = []

  parsedCommands
    ? parsedCommands.forEach((command: string, index: number) => {
        if (command === COMMANDS.V3_SWAP_EXACT_IN) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_IN
          const params = extractParams(inputsDetails, inputs[index])
          const path = parsePath(params.path)
          if (path.length) {
            parsed.push([
              getAction('Swap'),
              getToken(path[0]!, 0n),
              getLabel('for'),
              getToken(path[path.length - 1]!, 0n),
              ...(isFeedingNextAlternativeSwap(
                parsedCommands,
                inputs,
                index,
                path[path.length - 1]!
              )
                ? []
                : getUniversalRouterRecipientText(
                    accountOp.accountAddr,
                    params.recipient,
                    call.to
                  )),
              getDeadline(deadline)
            ])
          }
        } else if (command === COMMANDS.V3_SWAP_EXACT_OUT) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_OUT
          const params = extractParams(inputsDetails, inputs[index])
          const path = parsePath(params.path)

          if (path.length) {
            parsed.push([
              getAction('Swap'),
              getToken(path[path.length - 1]!, 0n),
              getLabel('for'),
              getToken(path[0]!, 0n),
              ...getUniversalRouterRecipientText(accountOp.accountAddr, params.recipient, call.to),
              getDeadline(deadline)
            ])
          }
        } else if (command === COMMANDS.SWEEP) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.SWEEP
          const params = extractParams(inputsDetails, inputs[index])
          if (
            [UNIVERSAL_ROUTER_MSG_SENDER, accountOp.accountAddr.toLowerCase()].includes(
              params.recipient.toLowerCase()
            )
          )
            parsed.push([getAction('Take'), getToken(params.token, params.amountMin)])
          else
            parsed.push([
              getAction('Send'),
              getToken(params.token, params.amountMin),
              getLabel('to'),
              getAddressVisualization(params.recipient)
            ])
        } else if (command === COMMANDS.PAY_PORTION) {
          // @NOTE: this is used for paying fee although its already calculated in the humanized response
          // @NOTE: no need to be displayed but we can add warning id the fee is too high?
          // The share can be up to 100% of what the router holds, so a payment that is more than
          // an ordinary interface fee must be displayed. Smaller fees stay hidden because they are
          // already included in the amounts of the swap.
          const { inputsDetails: payPortionInputsDetails } = COMMANDS_DESCRIPTIONS.PAY_PORTION
          const payPortionParams = extractParams(payPortionInputsDetails, inputs[index])
          if (
            payPortionParams.bips > MAX_HIDDEN_PAY_PORTION_BIPS &&
            !isOwnOrRouterRecipient(accountOp.accountAddr, payPortionParams.recipient, call.to) &&
            !isUniswapFeeRecipient(payPortionParams.recipient)
          )
            parsed.push([
              getAction('Send'),
              getLabel(`${Number(payPortionParams.bips) / 100}%`, true),
              getToken(payPortionParams.token, 0n),
              getLabel('to'),
              getAddressVisualization(payPortionParams.recipient)
            ])
          // const { inputsDetails } = COMMANDS_DESCRIPTIONS.PAY_PORTION
          // const params = extractParams(inputsDetails, inputs[index])
          // parsed.push({
          //   ...call,
          //   fullVisualization: [
          //     getAction('Pay fee'),
          //     getLabel('of'),
          //     // bips are fee. can be 0 or within 10-9999 and converts to %
          //     // https://docs.uniswap.org/contracts/v2/guides/interface-integration/custom-interface-linking#constraints
          //     getLabel(`${Number(params.bips) / 100}%`)
          //   ]
          // })
        } else if (command === COMMANDS.TRANSFER) {
          // when we swap with exact out the ui displays amount X for out token
          // the actual swap is X + small fee
          // and this is the small fee that is to be sent to the fee collector of uniswap
          // at later stage of the humanizer pipeline if swap with the same token is present exactly before this transfer
          // we will subtract the amount from the swap and remove this call from the visualization
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.TRANSFER
          const params = extractParams(inputsDetails, inputs[index])
          parsed.push([
            getAction('Send'),
            getToken(params.token, params.value),
            getLabel('to'),
            getAddressVisualization(params.recipient)
          ])
        } else if (command === COMMANDS.V2_SWAP_EXACT_IN) {
          try {
            const { inputsDetails } = COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_IN
            const params = extractParams(inputsDetails, inputs[index])
            const path = params.path

            parsed.push([
              getAction('Swap'),
              getToken(path[0], 0n),
              getLabel('for'),
              getToken(path[path.length - 1], 0n),
              ...getUniversalRouterRecipientText(accountOp.accountAddr, params.recipient, call.to),
              getDeadline(deadline)
            ])
          } catch {
            // alternative encoding, handled here
            // https://www.codeslaw.app/contracts/base/0x6Df1c91424F79E40E33B1A48F0687B666bE71075?file=contracts%2Fmodules%2Funiswap%2Fv2%2FV2SwapRouter.sol&start=158&end=160
            // https://www.codeslaw.app/contracts/base/0x6Df1c91424F79E40E33B1A48F0687B666bE71075?file=contracts%2Fmodules%2Funiswap%2Fv2%2FV2SwapRouter.sol&start=223&end=259
            const params = extractParams(ALTERNATIVE_V2_SWAP_EXACT_IN_INPUTS_DETAILS, inputs[index])

            if ((params.path.length / (2 + 40)) % 1 === 0) {
              const tokenOut = '0x' + params.path.slice(-40)
              parsed.push([
                getAction('Swap'),
                getToken(params.path.slice(0, 42), 0n),
                getLabel('for'),
                getToken(tokenOut, 0n),
                // in this encoding the first address is the one that receives the swap output,
                // unless that output only goes to the pool of the next hop
                ...(isFeedingNextAlternativeSwap(parsedCommands, inputs, index, tokenOut)
                  ? []
                  : getUniversalRouterRecipientText(accountOp.accountAddr, params.user, call.to))
              ])
            }
          }
        } else if (command === COMMANDS.V2_SWAP_EXACT_OUT) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_OUT
          const params = extractParams(inputsDetails, inputs[index])
          const path = params.path

          parsed.push([
            getAction('Swap'),
            getToken(path[0], 0n),
            getLabel('for'),
            getToken(path[path.length - 1], 0n),
            ...getUniversalRouterRecipientText(accountOp.accountAddr, params.recipient, call.to),
            getDeadline(deadline)
          ])
        } else if (command === COMMANDS.PERMIT2_TRANSFER_FROM) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.PERMIT2_TRANSFER_FROM
          const params = extractParams(inputsDetails, inputs[index])
          // Moves tokens of the signer, through a Permit2 allowance, to the recipient. Sending them
          // to the router is the normal first step of a swap and is covered by the swap itself.
          if (isOwnOrRouterRecipient(accountOp.accountAddr, params.recipient, call.to))
            parsed.push([
              getAction('Uniswap action'),
              getLabel('to'),
              getAddressVisualization(call.to)
            ])
          else
            parsed.push([
              getAction('Send'),
              getToken(params.token, params.amount),
              getLabel('to'),
              getAddressVisualization(params.recipient)
            ])
        } else if (command === COMMANDS.PERMIT2_PERMIT) {
          const {
            permit: {
              details: { token, amount /* expiration, nonce */ },
              spender
              // sigDeadline
            }
            // signature
          } = extractParams(COMMANDS_DESCRIPTIONS.PERMIT2_PERMIT.inputsDetails, inputs[index])
          parsed.push([
            getAction('Grant approval'),
            getLabel('for'),
            getToken(token, amount),
            getLabel('to'),
            getAddressVisualization(spender)
          ])
        } else if (command === COMMANDS.WRAP_ETH) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.WRAP_ETH
          const params = extractParams(inputsDetails, inputs[index])
          const wrapRecipientText = getUniversalRouterRecipientText(
            accountOp.accountAddr,
            params.recipient,
            call.to
          )
          // the wrapped tokens go to the recipient, so a wrap for someone else is shown even when
          // the minimum amount is zero
          if (params.amountMin || wrapRecipientText.length)
            parsed.push([...getWrapping(zeroAddress, params.amountMin), ...wrapRecipientText])
        } else if (command === COMMANDS.UNWRAP_WETH) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.UNWRAP_WETH
          const params = extractParams(inputsDetails, inputs[index])

          const unwrapRecipientText = getUniRecipientText(accountOp.accountAddr, params.recipient)
          // the minimum amount is not the amount sent: everything the router holds is unwrapped and
          // sent to the recipient, so an unwrap for someone else is shown even when it is zero
          if (params.amountMin || unwrapRecipientText.length)
            parsed.push([getAction('Unwrap'), getToken(zeroAddress, 0n), ...unwrapRecipientText])
        } else if (command === COMMANDS.V4_SWAP) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.V4_SWAP
          const params = extractParams(inputsDetails, inputs[index])
          const v4NewHumanization = parseV4Actions(
            params.actions,
            params.params,
            accountOp.accountAddr,
            call.to
          )
          parsed.push(v4NewHumanization)
        } else {
          if (!call.to)
            throw Error('Humanizer: should not be inside the uniswap module when !call.to')
          parsed.push([
            getAction('Uniswap action'),
            getLabel('to'),
            getAddressVisualization(call.to)
          ])
        }
      })
    : parsed.push([getAction('Uniswap action'), getLabel('to'), getAddressVisualization(call.to)])

  return uniReduce(parsed)
}

export const uniUniversalRouter: HumanizerUniMatcher = {
  [toFunctionSelector(executeWithDeadlineAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    const { args } = decodeFunctionData({ abi: executeWithDeadlineAbi, data: call.data })
    const [commands, inputs, deadline] = args
    return humanizeUniversalRouterCommands(commands, inputs, deadline, accountOp, call)
  }
}
