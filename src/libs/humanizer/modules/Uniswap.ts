import { ethers } from 'ethers'
import { AccountOp } from '../../accountOp/accountOp'
import { Ir, IrCall } from '../interfaces'
import { getAction, getLable, getToken, getRecipientText, parsePath } from '../utils'

const deadlineText = (deadlineSecs: number, mined = false) => {
  if (mined) return ''
  const minute = 60000
  const deadline = deadlineSecs * 1000
  const diff = deadline - Date.now()
  if (diff < 0 && diff > -minute * 2) return ', expired just now'
  // Disabled this: this is a bit of a hack cause we don't want it to show for mined txns
  // we don't really need it for pending ones, simply because we'll show the big error message instead
  // if (diff < 0) return `, expired ${Math.floor(-diff / minute)} minutes ago`
  if (diff < 0) return ''
  if (diff < minute) return ', expires in less than a minute'
  if (diff < 10 * minute) return `, expires in ${Math.floor(diff / minute)} minutes`
  return ''
}

// @NOTE Stolen from ambire-wallet
const uniV32Mapping = (humanizerInfo: any) => {
  const ifaceV32 = new ethers.Interface(humanizerInfo.abis.UniV3Router2)

  return {
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
      return (
        (parsed.length ? parsed : ['Unknown Uni V3 interaction'])
          // the .slice(2) is needed cause usuall this returns something like ", expires"... and we concat all actions with ", " anyway
          .concat([deadlineText(Number(deadline)).slice(2)])
          .filter((x: any) => x)
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
    }
  }
}

export function uniswapHumanizer(accountOp: AccountOp, currentIr: Ir): [Ir, Promise<any>[]] {
  // @TODO: Unify using imported abis vs abis from accountOp
  const matcher = {
    ...uniV32Mapping(accountOp.humanizerMeta)
  }
  const newCalls = currentIr.calls.map((call: IrCall) => {
    return { ...call, fullVisualization: matcher[call.data.substring(0, 10)](accountOp, call) }
  })
  const newIr = { calls: newCalls }
  return [newIr, []]
}
