import { AbiCoder, Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getKnownAbi,
  getLabel,
  getRecipientText,
  getToken,
  getUnknownVisualization,
  getWraping
} from '../../utils'
import { COMMANDS, COMMANDS_DESCRIPTIONS } from './Commands'
import { parsePath } from './utils'

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

// '0x1234' => ['0x12', '0x34']
function parseCommands(commands: string, emitError: Function): string[] | null {
  try {
    if (!commands.startsWith('0x') || commands.length % 2 !== 0) return null
    const hex = commands.slice(2)
    const hexRegex = /[0-9A-Fa-f]/g
    if (!hexRegex.test(hex)) return null
    const res = hex.match(/.{2}/g)?.map((p: string) => `0x${p}`)
    return res as string[]
  } catch (e) {
    emitError({
      level: 'minor',
      message: 'Unexpected error in parinsing uniswap commands',
      error: e
    })
    return null
  }
}

// @TODO add txns parsing (example for turning swap 1.15 and send 0.15 to swap 1.00)
export const uniUniversalRouter = (
  humanizerInfo: HumanizerMeta,
  options?: any
): { [x: string]: (a: AccountOp, c: IrCall) => IrCall[] } => {
  const ifaceUniversalRouter = new Interface(getKnownAbi(humanizerInfo, 'UniswapUniversalRouter'))
  return {
    [`${
      ifaceUniversalRouter.getFunction(
        'execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)'
      )?.selector
    }`]: (accountOp: AccountOp, call: IrCall) => {
      const [commands, inputs, deadline] = ifaceUniversalRouter.parseTransaction(call)?.args || []
      const parsedCommands = parseCommands(commands, options.emitError)
      const parsed: IrCall[] = []

      // if (!)
      //   parsed.push({ ...call, fullVisualization: getUnknownVisualization('Uni V3', call) })
      parsedCommands
        ? parsedCommands.forEach((command: string, index: number) => {
            if (command === COMMANDS.V3_SWAP_EXACT_IN) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_IN
              const params = extractParams(inputsDetails, inputs[index])
              const path = parsePath(params.path)
              parsed.push({
                ...call,
                fullVisualization: [
                  getAction('Swap'),
                  getToken(path[0], params.amountIn),
                  getLabel('for at least'),
                  getToken(path[path.length - 1], params.amountOutMin),
                  getDeadline(deadline)
                ]
              })
            } else if (command === COMMANDS.V3_SWAP_EXACT_OUT) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_OUT
              const params = extractParams(inputsDetails, inputs[index])
              const path = parsePath(params.path)

              parsed.push({
                ...call,
                fullVisualization: [
                  getAction('Swap up  to'),
                  getToken(path[path.length - 1], params.amountInMax),
                  getLabel('for'),
                  getToken(path[0], params.amountOut),
                  getDeadline(deadline)
                ]
              })
            } else if (command === COMMANDS.SWEEP) {
              // @NOTE: no need to be displayed, generally uses sentinel values
              // @TODO: research more
              // const { inputsDetails } = COMMANDS_DESCRIPTIONS.SWEEP
              // const params = extractParams(inputsDetails, inputs[index])
              // console.log({ params })
              // parsed.push({
              //   ...call,
              //   fullVisualization: [
              //     getAction('Take'),
              //     getLabel('at least'),
              //     getToken(params.token, params.amountMin)
              //   ]
              // })
            } else if (command === COMMANDS.PAY_PORTION) {
              // @NOTE: this is used for paying fee altough its already calculated in the humanized response
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
              // @NOTE: this is used for paying fee altough its already calculated in the humanized response
              // @NOTE: no need to be displayed but we can add warning id the fee is too high?
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.TRANSFER
              const params = extractParams(inputsDetails, inputs[index])
              parsed.push({
                ...call,
                fullVisualization: [
                  getAction('Send'),
                  getToken(params.token, params.value),
                  getLabel('to'),
                  getAddressVisualization(params.recipient)
                ]
              })
            } else if (command === COMMANDS.V2_SWAP_EXACT_IN) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_IN
              const params = extractParams(inputsDetails, inputs[index])
              const path = params.path

              parsed.push({
                ...call,
                fullVisualization: [
                  getAction('Swap'),
                  getToken(path[0], params.amountIn),
                  getLabel('for at least'),
                  getToken(path[path.length - 1], params.amountOutMin),
                  getDeadline(deadline)
                ]
              })
            } else if (command === COMMANDS.V2_SWAP_EXACT_OUT) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_OUT
              const params = extractParams(inputsDetails, inputs[index])
              const path = params.path

              parsed.push({
                ...call,
                fullVisualization: [
                  getAction('Swap up  to'),
                  getToken(path[0], params.amountInMax),
                  getLabel('for'),
                  getToken(path[path.length - 1], params.amountOut),
                  getDeadline(deadline)
                ]
              })
            } else if (command === COMMANDS.PERMIT2_PERMIT) {
              parsed.push({
                ...call,
                fullVisualization: [
                  // @TODO extract args (first we have to add them to the COMMANDS_DESCRIPTIONS object)
                  getLabel('Approved Uniswap to use the following token via signed message.')
                ]
              })
            } else if (command === COMMANDS.WRAP_ETH) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.WRAP_ETH
              const params = extractParams(inputsDetails, inputs[index])
              params.amountMin &&
                parsed.push({
                  ...call,
                  fullVisualization: getWraping(ZeroAddress, params.amountMin)
                })
            } else if (command === COMMANDS.UNWRAP_WETH) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.UNWRAP_WETH
              const params = extractParams(inputsDetails, inputs[index])

              params.amountMin &&
                parsed.push({
                  ...call,
                  fullVisualization: [
                    getAction('Unwrap'),
                    getToken(ZeroAddress, params.amountMin),
                    ...getRecipientText(accountOp.accountAddr, params.recipient)
                  ]
                })
            } else
              parsed.push({ ...call, fullVisualization: getUnknownVisualization('Uni V3', call) })
          })
        : parsed.push({ ...call, fullVisualization: getUnknownVisualization('Uni V3', call) })

      return parsed
    }
  }
}
