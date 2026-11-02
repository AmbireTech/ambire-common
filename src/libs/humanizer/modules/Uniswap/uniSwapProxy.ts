import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { summarizeUniversalRouterCommands } from './summarize'
import { ROUTER, USER, exact } from './effects'
import { UniswapSummaryMatcher } from './interfaces'

// SwapProxy pulls `amount` of `token` from the caller, then forwards `commands`/`inputs`/`deadline`
// to the Uniswap Universal Router it was given, using the same command encoding as the router itself
// (https://etherscan.io/address/0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9#code)
// The proxy is treated as the signer: what it pulls from the caller and what it sends back is not
// followed, so a call through it is described like a call to the router.
const executeAbi = parseAbi([
  'function execute(address router, address token, uint256 amount, bytes commands, bytes[] inputs, uint256 deadline) payable'
])

export const uniSwapProxy: UniswapSummaryMatcher = {
  [toFunctionSelector(executeAbi[0])]: (accountOp, call) => {
    const { args } = decodeFunctionData({ abi: executeAbi, data: call.data })
    const [, token, amount, commands, inputs, deadline] = args
    // the proxy pulls the tokens from the signer and gives them to the router
    return summarizeUniversalRouterCommands(commands, inputs, deadline, accountOp, call, [
      {
        type: 'transfer',
        token: token.toLowerCase(),
        from: USER,
        to: ROUTER,
        amount: exact(amount)
      }
    ])
  }
}
