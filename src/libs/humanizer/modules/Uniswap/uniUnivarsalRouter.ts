import { ethers } from 'ethers'
import {
  getAction,
  getDeadlineText,
  getLabel,
  getRecipientText,
  getToken,
  getWraping,
  getAddress
} from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
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
      // basic arrayifying 1. removes 0x 2. splits into hex pairs 3. parse to nums
      // '0x1234' => ['0x12', '0x34']
      const parsedCommands = commands
        .slice(2)
        .match(/.{2}/g)
        .map((p: string) => `0x${p}`)
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
              getDeadlineText(deadline)
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
              getAction('Transfer'),
              getToken(params.token, params.value),
              getLabel('to'),
              getAddress(params.recipient)
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
              getDeadlineText(deadline)
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
              getDeadlineText(deadline)
            ]
          })
        } else if (command === COMMANDS.PERMIT2_PERMIT) {
          parsed.push({
            ...call,
            fullVisualization: [
              getLabel('Approved Uniswap to use the following token via signed message.')
            ]
          })
        } else if (command === COMMANDS.WRAP_ETH) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.WRAP_ETH
          const params = extractParams(inputsDetails, inputs[index])
          parsed.push({
            ...call,
            fullVisualization: getWraping(params.amountMin)
          })
        } else if (command === COMMANDS.UNWRAP_WETH) {
          const { inputsDetails } = COMMANDS_DESCRIPTIONS.UNWRAP_WETH
          const params = extractParams(inputsDetails, inputs[index])
          parsed.push({
            ...call,
            fullVisualization: [
              getAction('Unwrap'),
              getToken(ethers.ZeroAddress, params.amountMin),
              ...getRecipientText(accountOp.accountAddr, params.recipient)
            ]
          })
        } else parsed.push({ ...call, fullVisualization: [getLabel('Unknown Uni V3 interaction')] })
      })
      console.log(parsed)
      console.log(parsed.flat)
      return parsed
    }
  }
}
