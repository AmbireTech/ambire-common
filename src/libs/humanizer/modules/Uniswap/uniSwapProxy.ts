import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { UNISWAP_UNIVERSAL_ROUTERS } from '../../../../consts/addresses'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'
import { ROUTER, USER, exact } from './effects'
import { UniswapSummaryMatcher } from './interfaces'
import { summarizeUniversalRouterCommands } from './summarize'
import { UNIVERSAL_ROUTER_CHAIN_IDS } from './universalRouterChains'

// SwapProxy pulls `amount` of `token` from the caller, then forwards `commands`/`inputs`/`deadline`
// to the Uniswap Universal Router it was given, using the same command encoding as the router itself
// (https://etherscan.io/address/0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9#code)
// The proxy is treated as the signer: what it pulls from the caller and what it sends back is not
// followed, so a call through it is described like a call to the router.
const executeAbi = parseAbi([
  'function execute(address router, address token, uint256 amount, bytes commands, bytes[] inputs, uint256 deadline) payable'
])

/**
 * True when the address is a Universal Router of Uniswap on the network. The proxy sends the tokens
 * to any address that it is given, so the commands are described as Universal Router commands only
 * for an address that is known to be one.
 */
const isUniversalRouterOnNetwork = (chainId: bigint, address: string): boolean => {
  const lowerCaseAddress = address.toLowerCase()
  return (
    !!UNIVERSAL_ROUTER_CHAIN_IDS[lowerCaseAddress]?.includes(chainId) ||
    UNISWAP_UNIVERSAL_ROUTERS[Number(chainId)]?.toLowerCase() === lowerCaseAddress
  )
}

export const uniSwapProxy: UniswapSummaryMatcher = {
  [toFunctionSelector(executeAbi[0])]: (accountOp, call) => {
    const { args } = decodeFunctionData({ abi: executeAbi, data: call.data })
    const [router, token, amount, commands, inputs, deadline] = args
    // The commands are not described when they go to an address that is not a Universal Router,
    // because they do not do what they say there. The tokens of the signer go to that address.
    if (!isUniversalRouterOnNetwork(accountOp.chainId, router)) {
      return {
        visualization: [
          getAction('Send'),
          getToken(token, amount),
          getLabel('to'),
          getAddressVisualization(router)
        ],
        warnings: []
      }
    }
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
