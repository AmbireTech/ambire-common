import { AbiCoder, Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { UniswapUniversalRouter } from '../../const/abis'
import { IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken,
  getUnknownVisualization,
  getWrapping
} from '../../utils'
import { COMMANDS, COMMANDS_DESCRIPTIONS } from './Commands'
import { getUniRecipientText, parsePath } from './utils'

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
function parseCommands(commands: string, emitError?: Function): string[] | null {
  try {
    if (!commands.startsWith('0x') || commands.length % 2 !== 0) return null
    const hex = commands.slice(2)
    const hexRegex = /[0-9A-Fa-f]/g
    if (!hexRegex.test(hex)) return null
    const res = hex.match(/.{2}/g)?.map((p: string) => `0x${p}`)
    return res as string[]
  } catch (e) {
    emitError &&
      emitError({
        level: 'minor',
        message: 'Unexpected error in parsing uniswap commands',
        error: e
      })
    return null
  }
}

export const uniUniversalRouter = (
  options?: any
): { [x: string]: (a: AccountOp, c: IrCall) => IrCall[] } => {
  const ifaceUniversalRouter = new Interface(UniswapUniversalRouter)
  return {
    [`${
      ifaceUniversalRouter.getFunction(
        'execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)'
      )?.selector
    }`]: (accountOp: AccountOp, call: IrCall) => {
      const [commands, inputs, deadline] = ifaceUniversalRouter.parseTransaction(call)?.args || []
      const parsedCommands = parseCommands(commands, options?.emitError)
      const parsed: IrCall[] = []

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
              // this call is can be ignored as it only ensures that the wanted swap
              // actually results in the output funds being sent to the user
              // if there is any problem with this call, the simulation should detect it
              // const { inputsDetails } = COMMANDS_DESCRIPTIONS.SWEEP
              // const params = extractParams(inputsDetails, inputs[index])
              // parsed.push({
              //   ...call,
              //   fullVisualization: [
              //     getAction('Take'),
              //     getLabel('at least'),
              //     getToken(params.token, params.amountMin)
              //   ]
              // })
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
              const {
                permit: {
                  details: { token, amount /* expiration, nonce */ },
                  spender
                  // sigDeadline
                }
                // signature
              } = extractParams(COMMANDS_DESCRIPTIONS.PERMIT2_PERMIT.inputsDetails, inputs[index])
              parsed.push({
                ...call,
                fullVisualization: [
                  getAction('Grant approval'),
                  getLabel('for'),
                  getToken(token, amount),
                  getLabel('to'),
                  getAddressVisualization(spender)
                ]
              })
            } else if (command === COMMANDS.WRAP_ETH) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.WRAP_ETH
              const params = extractParams(inputsDetails, inputs[index])
              params.amountMin &&
                parsed.push({
                  ...call,
                  fullVisualization: getWrapping(ZeroAddress, params.amountMin)
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
                    ...getUniRecipientText(accountOp.accountAddr, params.recipient)
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
