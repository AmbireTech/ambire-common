import { ethers } from 'ethers'
import { getAction, getDeadlineText, getLabel, getRecipientText, getToken } from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualization, IrCall } from '../../interfaces'
import { COMMANDS, COMMANDS_DESCRIPTIONS } from './Commands'
import { parsePath } from './utils'

const coder = new ethers.AbiCoder()

const extractParams = (inputsDetails: any, input: any) => {
  const types = inputsDetails.map((i: any) => i.type)
  const decodedInput = coder.decode(types, input)

  const params: any = {}
  inputsDetails.forEach((item: any, index: number) => {
    params[item.name] = decodedInput[index]
  })

  return params
}

export const uniUniversalRouter = (
  humanizerInfo: any
): { [x: string]: (a: AccountOp, c: IrCall) => IrCall[] } => {
  const ifaceUniversalRouter = new ethers.Interface(humanizerInfo?.['abis:UniswapUniversalRouter'])

  return {
    [`${
      ifaceUniversalRouter.getFunction(
        'execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)'
      )?.selector
    }`]: (accountOp: AccountOp, call: IrCall) => {
      const [commands, inputs, deadline] = ifaceUniversalRouter.parseTransaction(call)?.args || []
      const parsedCommands = commands
        .slice(2)
        .match(/.{2}/g)
        .map((c: string) => parseInt(c, 16))

      const parsed: IrCall[] = []
      parsedCommands.forEach((command: string, index: number) => {
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
              getDeadlineText(deadline)
            ].filter((v) => v) as HumanizerVisualization[]
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
              getDeadlineText(deadline)
            ].filter((v) => v) as HumanizerVisualization[]
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
              getDeadlineText(deadline)
            ].filter((v) => v) as HumanizerVisualization[]
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
              getDeadlineText(deadline)
            ].filter((v) => v) as HumanizerVisualization[]
          })
        } else if (command === COMMANDS.PERMIT2_PERMIT) {
          parsed.push({
            ...call,
            fullVisualization: [
              getLabel('Approved Uniswap to use the following token via signed message.')
            ]
          })
        } else if (command === COMMANDS.UNWRAP_WETH) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.UNWRAP_WETH
          const params = extractParams(inputsDetails, inputs[index])
          parsed.push({
            ...call,
            fullVisualization: [
              getAction('Unwrap at least'),
              getToken(ethers.ZeroAddress, params.amountMin),
              ...getRecipientText(accountOp.accountAddr, params.recipient)
            ]
          })
        } else parsed.push({ ...call, fullVisualization: [getLabel('Unknown Uni V3 interaction')] })
      })

      return parsed.flat()
    }
  }
}
