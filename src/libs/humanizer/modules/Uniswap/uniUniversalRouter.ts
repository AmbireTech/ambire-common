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
import { COMMANDS, COMMANDS_DESCRIPTIONS, V4_ACTION_CODES, V4_ACTION_DESCRIPTORS } from './Commands'
import { HumanizerUniMatcher } from './interfaces'
import { getUniRecipientText, parsePath, uniReduce } from './utils'
import { AbiCoder } from 'ethers'

const coder = new AbiCoder()
const extractParams = (inputsDetails: any, input: any) => {
  const types = inputsDetails.map((i: any) => i.type)
  const decodedInput = coder.decode(types, input)
  const params: any = {}
  inputsDetails.forEach((item: any, index: number) => {
    params[item.name] = decodedInput[index]
  })

  return params
}

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

function parseV4Actions(
  actions: string,
  totalParams: Hex[],
  accountAddr: string
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
      const { swap } = extractParams(V4_ACTION_DESCRIPTORS.SWAP_EXACT_IN, param)
      const [tokenIn, path, amountIn, amountOut] = swap
      const lastToken = path[path.length - 1][0]

      parsed.push([
        getAction('Swap'),
        getToken(tokenIn, 0n),
        getLabel('for'),
        getToken(lastToken, 0n)
      ])
    } else if (action === V4_ACTION_CODES.SWAP_EXACT_OUT) {
      const { swap } = extractParams(V4_ACTION_DESCRIPTORS.SWAP_EXACT_OUT, param)
      const [tokenOut, path, amountOut, amountIn] = swap
      const firstToken = path[0][0]

      parsed.push([
        getAction('Swap'),
        getToken(firstToken, 0n),
        getLabel('for'),
        getToken(tokenOut, 0n)
      ])
    } else if (action === V4_ACTION_CODES.SWAP_EXACT_IN_SINGLE) {
      const { swap } = extractParams(V4_ACTION_DESCRIPTORS.SWAP_EXACT_IN_SINGLE, param)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [poolKey, zeroForOne, amountIn, amountOutMinimum, hookData] = swap
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [currency0, currency1, fee, tickSpacing, hooks] = poolKey

      parsed.push([
        getAction('Swap'),
        getToken(currency0, 0n),
        getLabel('for'),
        getToken(currency1, 0n)
      ])
    } else if (action === V4_ACTION_CODES.SWAP_EXACT_OUT_SINGLE) {
      const { swap } = extractParams(V4_ACTION_DESCRIPTORS.SWAP_EXACT_OUT_SINGLE, param)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [poolKey, zeroForOne, amountOut, amountInMaximum, hookData] = swap
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [currency0, currency1, fee, tickSpacing, hooks] = poolKey

      parsed.push([
        getAction('Swap'),
        getToken(currency0, 0n),
        getLabel('for'),
        getToken(currency1, 0n)
      ])
    } else if (action === V4_ACTION_CODES.TAKE) {
      const args = extractParams(V4_ACTION_DESCRIPTORS.TAKE, param)
      if (
        args.amount &&
        ['0x0000000000000000000000000000000000000002', accountAddr].includes(args.recipient)
      )
        parsed.push([getAction('Take'), getToken(args.currency, args.amount)])
    } else if (action === V4_ACTION_CODES.TAKE_ALL) {
      const args = extractParams(V4_ACTION_DESCRIPTORS.TAKE_ALL, param)
      parsed.push([getAction('Take'), getToken(args.currency, args.minAmount)])
    } else {
      parsed.push([getAction('Unknown uniswap V4 action')])
    }
  })
  return uniReduce(parsed)
}

const executeWithDeadlineAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'
])

export const uniUniversalRouter: HumanizerUniMatcher = {
  [toFunctionSelector(executeWithDeadlineAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    if (!call.to) throw Error('Humanizer: should not be inside the uniswap module when !call.to')
    const { args } = decodeFunctionData({ abi: executeWithDeadlineAbi, data: call.data })
    const [commands, inputs, deadline] = args
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
                getDeadline(deadline)
              ])
            }
          } else if (command === COMMANDS.SWEEP) {
            const { inputsDetails } = COMMANDS_DESCRIPTIONS.SWEEP
            const params = extractParams(inputsDetails, inputs[index])
            if (
              ['0x0000000000000000000000000000000000000001', accountOp.accountAddr].includes(
                params.recipient
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
                getDeadline(deadline)
              ])
            } catch (e) {
              // alternative encoding, handled here
              // https://www.codeslaw.app/contracts/base/0x6Df1c91424F79E40E33B1A48F0687B666bE71075?file=contracts%2Fmodules%2Funiswap%2Fv2%2FV2SwapRouter.sol&start=158&end=160
              // https://www.codeslaw.app/contracts/base/0x6Df1c91424F79E40E33B1A48F0687B666bE71075?file=contracts%2Fmodules%2Funiswap%2Fv2%2FV2SwapRouter.sol&start=223&end=259
              const params = extractParams(
                [
                  { type: 'address', name: 'user' },
                  { type: 'uint256', name: 'amountIn' },
                  { type: 'uint256', name: 'amountOut' },
                  { type: 'bytes', name: 'path' },
                  { type: 'bool', name: 'isUserPayer' },
                  { type: 'bool', name: 'isUni' }
                ],
                inputs[index]
              )

              if ((params.path.length / (2 + 40)) % 1 === 0) {
                parsed.push([
                  getAction('Swap'),
                  getToken(params.path.slice(0, 42), 0n),
                  getLabel('for'),
                  getToken('0x' + params.path.slice(-40), 0n)
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
              getDeadline(deadline)
            ])
          } else if (command === COMMANDS.PERMIT2_PERMIT) {
            const {
              permit: {
                details: { token, amount /* expiration, nonce */ },
                spender
                // sigDeadline
              }
              // signature
            } = extractParams(
              COMMANDS_DESCRIPTIONS.PERMIT2_PERMIT.inputsDetails,
              inputs[index]
            )
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
            params.amountMin && parsed.push(getWrapping(zeroAddress, params.amountMin))
          } else if (command === COMMANDS.UNWRAP_WETH) {
            const { inputsDetails } = COMMANDS_DESCRIPTIONS.UNWRAP_WETH
            const params = extractParams(inputsDetails, inputs[index])

            params.amountMin &&
              parsed.push([
                getAction('Unwrap'),
                getToken(zeroAddress, 0n),
                ...getUniRecipientText(accountOp.accountAddr, params.recipient)
              ])
          } else if (command === COMMANDS.V4_SWAP) {
            const { inputsDetails } = COMMANDS_DESCRIPTIONS.V4_SWAP
            const params = extractParams(inputsDetails, inputs[index])
            const v4NewHumanization = parseV4Actions(
              params.actions,
              params.params,
              accountOp.accountAddr
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
}
