import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { UniswapSummaryMatcher } from './interfaces'
import { summarizeUniversalRouterCommands } from './summarize'

const executeWithDeadlineAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'
])

export const uniUniversalRouter: UniswapSummaryMatcher = {
  [toFunctionSelector(executeWithDeadlineAbi[0])]: (accountOp, call) => {
    const { args } = decodeFunctionData({ abi: executeWithDeadlineAbi, data: call.data })
    const [commands, inputs, deadline] = args
    return summarizeUniversalRouterCommands(commands, inputs, deadline, accountOp, call)
  }
}
