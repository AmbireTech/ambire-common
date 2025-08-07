import { AbiCoder, Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { UniswapUniversalRouter } from '../../const/abis'
import { HumanizerVisualization, IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken,
  getWrapping
} from '../../utils'
import { COMMANDS, COMMANDS_DESCRIPTIONS } from './Commands'
import { HumanizerUniMatcher } from './interfaces'
import { getUniRecipientText, parsePath, uniReduce } from './utils'

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

export const uniUniversalRouter = (): HumanizerUniMatcher => {
  const ifaceUniversalRouter = new Interface(UniswapUniversalRouter)
  return {
    [`${
      ifaceUniversalRouter.getFunction(
        'execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)'
      )?.selector
    }`]: (accountOp: AccountOp, call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be inside the uniswap module when !call.to')
      const [commands, inputs, deadline] = ifaceUniversalRouter.parseTransaction(call)?.args || []
      const parsedCommands = parseCommands(commands)
      const parsed: HumanizerVisualization[][] = []

      parsedCommands
        ? parsedCommands.forEach((command: string, index: number) => {
            if (command === COMMANDS.V3_SWAP_EXACT_IN) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_IN
              const params = extractParams(inputsDetails, inputs[index])
              const path = parsePath(params.path)
              parsed.push([
                getAction('Swap'),
                getToken(path[0], params.amountIn),
                getLabel('for at least'),
                getToken(path[path.length - 1], params.amountOutMin),
                getDeadline(deadline)
              ])
            } else if (command === COMMANDS.V3_SWAP_EXACT_OUT) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_OUT
              const params = extractParams(inputsDetails, inputs[index])
              const path = parsePath(params.path)

              parsed.push([
                getAction('Swap up to'),
                getToken(path[path.length - 1], params.amountInMax),
                getLabel('for'),
                getToken(path[0], params.amountOut),
                getDeadline(deadline)
              ])
            } else if (command === COMMANDS.SWEEP) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.SWEEP
              const params = extractParams(inputsDetails, inputs[index])
              if (
                ['0x0000000000000000000000000000000000000001', accountOp.accountAddr].includes(
                  params.recipient
                )
              )
                parsed.push([
                  getAction('Take'),
                  getLabel('at least'),
                  getToken(params.token, params.amountMin)
                ])
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
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_IN
              const params = extractParams(inputsDetails, inputs[index])
              const path = params.path

              parsed.push([
                getAction('Swap'),
                getToken(path[0], params.amountIn),
                getLabel('for at least'),
                getToken(path[path.length - 1], params.amountOutMin),
                getDeadline(deadline)
              ])
            } else if (command === COMMANDS.V2_SWAP_EXACT_OUT) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_OUT
              const params = extractParams(inputsDetails, inputs[index])
              const path = params.path

              parsed.push([
                getAction('Swap up to'),
                getToken(path[0], params.amountInMax),
                getLabel('for'),
                getToken(path[path.length - 1], params.amountOut),
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
              params.amountMin && parsed.push(getWrapping(ZeroAddress, params.amountMin))
            } else if (command === COMMANDS.UNWRAP_WETH) {
              const { inputsDetails } = COMMANDS_DESCRIPTIONS.UNWRAP_WETH
              const params = extractParams(inputsDetails, inputs[index])

              params.amountMin &&
                parsed.push([
                  getAction('Unwrap'),
                  getToken(ZeroAddress, params.amountMin),
                  ...getUniRecipientText(accountOp.accountAddr, params.recipient)
                ])
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
        : parsed.push([
            getAction('Uniswap action'),
            getLabel('to'),
            getAddressVisualization(call.to)
          ])

      return uniReduce(parsed)
    }
  }
}
