import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { HumanizerUniMatcher } from './interfaces'
import { humanizeUniversalRouterCommands } from './uniUniversalRouter'

// SwapProxy pulls `amount` of `token` from the caller, then forwards `commands`/`inputs`/`deadline`
// to the Uniswap Universal Router it was given, using the same command encoding as the router itself
// (https://etherscan.io/address/0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9#code)
const executeAbi = parseAbi([
  'function execute(address router, address token, uint256 amount, bytes commands, bytes[] inputs, uint256 deadline) payable'
])

export const uniSwapProxy: HumanizerUniMatcher = {
  [toFunctionSelector(executeAbi[0])]: (accountOp, call) => {
    const { args } = decodeFunctionData({ abi: executeAbi, data: call.data })
    const [, , , commands, inputs, deadline] = args
    return humanizeUniversalRouterCommands(commands, inputs, deadline, accountOp, call)
  }
}
