import { ethers } from 'ethers'
import { AccountOp } from '../../accountOp/accountOp'
import { Ir, IrCall } from '../interfaces'
import { getAction, getLable, getToken, getRecipientText, parsePath, getAddress } from '../utils'

const deadlineText = (deadlineSecs: number, mined = false) => {
  if (mined) return getLable('')
  const minute = 60000
  const deadline = deadlineSecs * 1000
  const diff = deadline - Date.now()
  if (diff < 0 && diff > -minute * 2) return getLable(', expired just now')
  // Disabled this: this is a bit of a hack cause we don't want it to show for mined txns
  // we don't really need it for pending ones, simply because we'll show the big error message instead
  // if (diff < 0) return getLable(`, expired ${Math.floor(-diff / minute)} minutes ago`
  if (diff < 0) return getLable('')
  if (diff < minute) return getLable(', expires in less than a minute')
  if (diff < 10 * minute) return getLable(`, expires in ${Math.floor(diff / minute)} minutes`)
  return getLable('')
}

// @TODO func selectors for both routers seem to be the same

// Stolen from ambire-wallet
const uniV32Mapping = (humanizerInfo: any) => {
  const ifaceV32 = new ethers.Interface(humanizerInfo.abis.UniV3Router2)
  return {
    // uint256 is deadline
    [`${ifaceV32.getFunction('multicall(uint256,bytes[])')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [deadline, calls] = ifaceV32.parseTransaction(call)?.args || []
      const mappingResult = uniV32Mapping(humanizerInfo)
      // @TODO: Multicall that outputs ETH should be detected as such and displayed as one action
      // the current verbosity of "Swap ..., unwrap WETH to ETH" will be a nice pedantic quirk
      const parsed = calls
        .map((data: any) => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : null
        })
        .flat()
        .filter((x: any) => x)
      return (parsed.length ? parsed : getLable('Unknown Uni V3 interaction'))
        .concat([deadlineText(Number(deadline))])
        .filter((x: any) => x)
    },
    [`${ifaceV32.getFunction('multicall(bytes[])')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [calls] = ifaceV32.parseTransaction(call)?.args || []
      const mappingResult = uniV32Mapping(humanizerInfo)
      // @TODO: Multicall that outputs ETH should be detected as such and displayed as one action
      // the current verbosity of "Swap ..., unwrap WETH to ETH" will be a nice pedantic quirk
      const parsed = calls
        .map((data: any) => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : null
        })
        .flat()
        .filter((x: any) => x)
      return parsed.length ? parsed : getLable('Unknown Uni V3 interaction')
    },
    // bytes32 is prevBlockHash
    [`${ifaceV32.getFunction('multicall(bytes32, bytes[])')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [prevBlockHash, calls] = ifaceV32.parseTransaction(call)?.args || []
      const mappingResult = uniV32Mapping(humanizerInfo)
      // @TODO: Multicall that outputs ETH should be detected as such and displayed as one action
      // the current verbosity of "Swap ..., unwrap WETH to ETH" will be a nice pedantic quirk
      const parsed = calls
        .map((data: any) => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : null
        })
        .flat()
        .filter((x: any) => x)
      return (parsed.length ? parsed : getLable('Unknown Uni V3 interaction')).concat(
        getLable(`after block ${prevBlockHash}`)
      )
    },
    // NOTE: selfPermit is not supported cause it requires an ecrecover signature
    [`${ifaceV32.getFunction('exactInputSingle')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      // @TODO: consider fees
      return [
        getAction('Swap'),
        getToken(params.tokenIn, params.amountIn),
        getLable('for at least'),
        getToken(params.tokenOut, params.amountOutMin),
        ...getRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    [`${ifaceV32.getFunction('exactInput')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        getAction('Swap'),
        getToken(path[0], params.amountIn),
        getLable('for at least'),
        getToken(path[path.length - 1], params.amountOutMinimum),
        ...getRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    [`${ifaceV32.getFunction('exactOutputSingle')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Swap up to'),
        getToken(params.tokenIn, params.amountInMaximum),
        getLable('for'),
        getToken(params.tokenOut, params.amountOut),
        ...getRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    [`${ifaceV32.getFunction('exactOutput')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        getAction('Swap up to'),
        getToken(path[path.length - 1], params.amountInMaximum),
        getLable('for'),
        getToken(path[0], params.amountOut),
        ...getRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    [`${ifaceV32.getFunction('swapTokensForExactTokens')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      // NOTE: is amountInMax set when dealing with ETH? it should be... cause value and max are not the same thing
      const [amountOut, amountInMax, path, to] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Swap up to'),
        getToken(path[0], amountInMax),
        getLable('for'),
        getToken(path[path.length - 1], amountOut),
        ...getRecipientText(accountOp.accountAddr, to)
      ]
    },
    [`${ifaceV32.getFunction('swapExactTokensForTokens')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      // NOTE: is amountIn set when dealing with ETH?
      const [amountIn, amountOutMin, path, to] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Swap'),
        getToken(path[0], amountIn),
        getLable('for at least'),
        getToken(path[path.length - 1], amountOutMin),
        ...getRecipientText(accountOp.accountAddr, to)
      ]
    },
    [`${ifaceV32.getFunction('unwrapWETH9(uint256)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amountMin] = ifaceV32.parseTransaction(call)?.args || []
      return [getAction('Unwrap at least'), getToken(ethers.ZeroAddress, amountMin)]
    },
    // address is recipient
    [`${ifaceV32.getFunction('unwrapWETH9(uint256,address)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amountMin, recipient] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Unwrap at least'),
        getToken(ethers.ZeroAddress, amountMin),
        ...getRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    [`${ifaceV32.getFunction('sweepToken(address,uint256)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [token, amountMinimum] = ifaceV32.parseTransaction(call)?.args || []
      return [getAction('Sweep'), getLable('at least'), getToken(token, amountMinimum)]
    },
    [`${ifaceV32.getFunction('sweepToken(address,uint256,address)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [token, amountMinimum, recipient] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Sweep'),
        getLable('at least'),
        getToken(token, amountMinimum),
        ...getRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    [`${ifaceV32.getFunction('sweepTokenWithFee(address,uint256,uint256,address)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [token, amountMinimum, feeBips, feeRecipient] =
        ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Sweep'),
        getLable('at least'),
        getToken(token, amountMinimum),
        getLable('with fee'),
        getToken(token, feeBips),
        getLable('to'),
        getAddress(feeRecipient)
      ]
    },
    [`${
      ifaceV32.getFunction('sweepTokenWithFee(address,uint256,address,uint256,address)')?.selector
    }`]: (accountOp: AccountOp, call: IrCall) => {
      const [token, amountMinimum, recipient, feeBips, feeRecipient] =
        ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Sweep'),
        getLable('at least'),
        getToken(token, amountMinimum),
        getLable('with fee'),
        getToken(token, feeBips),
        getLable('to'),
        getAddress(feeRecipient),
        ...getRecipientText(accountOp.accountAddr, recipient)
      ]
    }
  }
}

// @NOTE Stolen from ambire-wallet
const uniV3Mappinig = (humanizerInfo: any) => {
  const ifaceV3 = new ethers.Interface(humanizerInfo.abis.UniV3Router)
  return {
    [`${ifaceV3.getFunction('multicall')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const args = ifaceV3.parseTransaction(call)?.args || []
      const calls = args[args.length - 1]
      const mappingResult = uniV32Mapping(humanizerInfo)
      // @TODO: Multicall that outputs ETH should be detected as such and displayed as one action
      // the current verbosity of "Swap ..., unwrap WETH to ETH" will be a nice pedantic quirk
      const parsed = calls
        .map((data: any) => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : null
        })
        .flat()
        .filter((x: any) => x)
      return parsed.length ? parsed : getLable('Unknown Uni V3 interaction')
    },
    // NOTE: selfPermit is not supported cause it requires an ecrecover signature
    [`${ifaceV3.getFunction('exactInputSingle')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      // @TODO: consider fees
      return [
        getAction('Swap'),
        getToken(params.tokenIn, params.amountIn),
        getLable('for at least'),
        getToken(params.tokenOut, params.amountOutMin),
        ...getRecipientText(accountOp.accountAddr, params.recipient),
        deadlineText(params.deadline)
      ]
    },
    [`${ifaceV3.getFunction('exactInput')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        getAction('Swap'),
        getToken(path[0], params.amountIn),
        getLable('for at least'),
        getToken(path[path.length - 1], params.amountOutMinimum),
        getRecipientText(accountOp.accountAddr, params.recipient),
        deadlineText(params.deadline)
      ]
    },
    [`${ifaceV3.getFunction('exactOutputSingle')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      return [
        getAction('Swap up to'),
        getToken(params.tokenIn, params.amountInMaximum),
        getLable('for'),
        getToken(params.tokenOut, params.amountOut),
        getRecipientText(accountOp.accountAddr, params.recipient),
        deadlineText(params.deadline)
      ]
    },
    [`${ifaceV3.getFunction('exactOutput')}`]: (accountOp: AccountOp, call: IrCall) => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        getAction('Swap up to'),
        getToken(path[path.length - 1], params.amountInMaximum),
        getLable('for'),
        getToken(path[0], params.amountOut),
        getRecipientText(accountOp.accountAddr, params.recipient),
        deadlineText(params.deadline)
      ]
    },
    // @NOTE moaybe ethers.ZeroAddress should be replaced with WETH address in all unwraps?
    [`${ifaceV3.getFunction('unwrapWETH9')}`]: (accountOp: AccountOp, call: IrCall) => {
      const [amountMin, recipient] = ifaceV3.parseTransaction(call)?.args || []
      return [
        getAction('Unwrap at least'),
        getToken(ethers.ZeroAddress, amountMin),
        getRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    [`${ifaceV3.getFunction('unwrapWETH9WithFee')}`]: (accountOp: AccountOp, call: IrCall) => {
      const [amountMin, recipient, feeBips, feeRecipient] =
        ifaceV3.parseTransaction(call)?.args || []
      return [
        getAction('Unwrap at least'),
        getLable('at least'),
        getToken(ethers.ZeroAddress, amountMin),
        getLable('with fee'),
        getToken(ethers.ZeroAddress, feeBips),
        getLable('to'),
        getAddress(feeRecipient),
        ...getRecipientText(accountOp.accountAddr, recipient)
      ]
    }
  }
}

export function uniswapHumanizer(accountOp: AccountOp, currentIr: Ir): [Ir, Promise<any>[]] {
  // @TODO: Unify using imported abis vs abis from accountOp
  const matcher = {
    ...uniV3Mappinig(accountOp.humanizerMeta),
    ...uniV32Mapping(accountOp.humanizerMeta)
  }
  const newCalls = currentIr.calls.map((call: IrCall) => {
    return { ...call, fullVisualization: matcher[call.data.substring(0, 10)](accountOp, call) }
  })
  const newIr = { calls: newCalls }
  return [newIr, []]
}
