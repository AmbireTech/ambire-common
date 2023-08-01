import { ethers } from 'ethers'
import { AccountOp } from 'libs/accountOp/accountOp'
import { IrCall } from 'libs/humanizer/interfaces'
import {
  getAction,
  getDeadlineText,
  getLable,
  getRecipientText,
  getToken
} from 'libs/humanizer/utils'
import { COMMANDS, COMMANDS_DESCRIPTIONS } from './Commands'

const coder = new ethers.AbiCoder()

const parsePath = (pathBytes: any) => {
  // some decodePacked fun
  // can we do this with Ethers AbiCoder? probably not
  const path = []
  // address, uint24
  for (let i = 2; i < pathBytes.length; i += 46) {
    path.push(`0x${pathBytes.substr(i, 40)}`)
  }
  return path
}
const extractParams = (inputsDetails: any, input: any) => {
  const types = inputsDetails.map((i: any) => i.type)
  const decodedInput = coder.decode(types, input)

  const params: any = {}
  inputsDetails.forEach((item: any, index: number) => {
    params[item.name] = decodedInput[index]
  })

  return params
}

export const uniUniversalRouter = (humanizerInfo: any) => {
  const ifaceUniversalRouter = new ethers.Interface(humanizerInfo.abis.UniswapUniversalRouter)

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

      const parsed: any[] = []
      parsedCommands.forEach((command: string, index: number) => {
        if (command === COMMANDS.V3_SWAP_EXACT_IN) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_IN
          const params = extractParams(inputsDetails, inputs[index])
          const path = parsePath(params.path)
          parsed.push([
            getAction('Swap'),
            getToken(path[0], params.amountIn),
            getLable('for at least'),
            getToken(path[path.length - 1], params.amountOutMin),
            getDeadlineText(Number(deadline))
          ])
        } else if (command === COMMANDS.V3_SWAP_EXACT_OUT) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_OUT
          const params = extractParams(inputsDetails, inputs[index])
          const path = parsePath(params.path)

          parsed.push([
            getAction('Swap up  to'),
            getToken(path[path.length - 1], params.amountInMax),
            getLable('for'),
            getToken(path[0], params.amountOut),
            getDeadlineText(Number(deadline))
          ])
        } else if (command === COMMANDS.V2_SWAP_EXACT_IN) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_IN
          const params = extractParams(inputsDetails, inputs[index])
          const path = params.path

          parsed.push([
            getAction('Swap'),
            getToken(path[0], params.amountIn),
            getLable('for at least'),
            getToken(path[path.length - 1], params.amountOutMin),
            getDeadlineText(Number(deadline))
          ])
        } else if (command === COMMANDS.V2_SWAP_EXACT_OUT) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_OUT
          const params = extractParams(inputsDetails, inputs[index])
          const path = params.path

          parsed.push([
            getAction('Swap up  to'),
            getToken(path[0], params.amountInMax),
            getLable('for'),
            getToken(path[path.length - 1], params.amountOut),
            getDeadlineText(Number(deadline))
          ])
        } else if (command === COMMANDS.PERMIT2_PERMIT) {
          parsed.push([getLable('Approved Uniswap to use the following token via signed message.')])
        } else if (command === COMMANDS.UNWRAP_WETH) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.UNWRAP_WETH
          const params = extractParams(inputsDetails, inputs[index])
          parsed.push([
            getAction('Unwrap at least'),
            getToken(ethers.ZeroAddress, params.amountMin),
            ...getRecipientText(accountOp.accountAddr, params.recipient)
          ])
        } else parsed.push([getLable('Unknown Uni V3 interaction')])
      })

      return parsed.flat()
    }
  }
}
