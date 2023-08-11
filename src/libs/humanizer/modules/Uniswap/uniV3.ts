import { ethers } from 'ethers'
import {
  getAction,
  getLable,
  getToken,
  getRecipientText,
  parsePath,
  getAddress,
  getDeadlineText
} from '../../utils'

import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'

// Stolen from ambire-wallet
const uniV32Mapping = (humanizerInfo: any) => {
  const ifaceV32 = new ethers.Interface(humanizerInfo?.['abis:UniV3Router2'])
  return {
    // uint256 is deadline
    // 0x5ae401dc
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
        .concat([getDeadlineText(deadline)])
        .filter((x: any) => x)
    },
    // 0xac9650d8
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
    // 0x1f0464d1
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
    // 0x04e45aaf
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
    // 0xb858183f
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
    // 0x5023b4df
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
    // 0x09b81346
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
    // 0x42712a67
    [`${ifaceV32.getFunction('swapTokensForExactTokens')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amountOut, amountInMax, path, to] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Swap up to'),
        getToken(path[0], amountInMax),
        getLable('for'),
        getToken(path[path.length - 1], amountOut),
        ...getRecipientText(accountOp.accountAddr, to)
      ]
    },
    // 0x472b43f3
    [`${ifaceV32.getFunction('swapExactTokensForTokens')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amountIn, amountOutMin, path, to] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Swap'),
        getToken(path[0], amountIn),
        getLable('for at least'),
        getToken(path[path.length - 1], amountOutMin),
        ...getRecipientText(accountOp.accountAddr, to)
      ]
    },
    // 0x49616997
    [`${ifaceV32.getFunction('unwrapWETH9(uint256)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amountMin] = ifaceV32.parseTransaction(call)?.args || []
      return [getAction('Unwrap'), getLable('at least'), getToken(ethers.ZeroAddress, amountMin)]
    },
    // address is recipient
    // 0x49404b7c
    [`${ifaceV32.getFunction('unwrapWETH9(uint256,address)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amountMin, recipient] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Unwrap'),
        getLable('at least'),
        getToken(ethers.ZeroAddress, amountMin),
        ...getRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    // 0xe90a182f
    [`${ifaceV32.getFunction('sweepToken(address,uint256)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [token, amountMinimum] = ifaceV32.parseTransaction(call)?.args || []
      return [getAction('Sweep'), getLable('at least'), getToken(token, amountMinimum)]
    },
    // 0xdf2ab5bb
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
    // 0x3068c554
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
    // 0xe0e189a0
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

const uniV3Mapping = (humanizerInfo: any) => {
  const ifaceV3 = new ethers.Interface(humanizerInfo?.['abis:UniV3Router'])
  return {
    // 0xac9650d8
    [`${ifaceV3.getFunction('multicall')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const args = ifaceV3.parseTransaction(call)?.args || []
      const calls = args[args.length - 1]
      const mappingResult = uniV3Mapping(humanizerInfo)
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
    // 0x414bf389
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
        getDeadlineText(params.deadline)
      ]
    },
    // 0xc04b8d59
    [`${ifaceV3.getFunction('exactInput')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        getAction('Swap'),
        getToken(path[0], params.amountIn),
        getLable('for at least'),
        getToken(path[path.length - 1], params.amountOutMinimum),
        ...getRecipientText(accountOp.accountAddr, params.recipient),
        getDeadlineText(params.deadline)
      ]
    },
    // 0xdb3e2198
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
        ...getRecipientText(accountOp.accountAddr, params.recipient),
        getDeadlineText(params.deadline)
      ]
    },
    // 0xf28c0498
    [`${ifaceV3.getFunction('exactOutput')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        getAction('Swap up to'),
        getToken(path[path.length - 1], params.amountInMaximum),
        getLable('for'),
        getToken(path[0], params.amountOut),
        ...getRecipientText(accountOp.accountAddr, params.recipient),
        getDeadlineText(params.deadline)
      ]
    },
    // 0x49404b7c
    [`${ifaceV3.getFunction('unwrapWETH9')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [amountMin, recipient] = ifaceV3.parseTransaction(call)?.args || []
      return [
        getAction('Unwrap'),
        getLable('at least'),
        getToken(ethers.ZeroAddress, amountMin),
        ...getRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    // 0x9b2c0a37
    [`${ifaceV3.getFunction('unwrapWETH9WithFee')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amountMin, recipient, feeBips, feeRecipient] =
        ifaceV3.parseTransaction(call)?.args || []
      return [
        getAction('Unwrap'),
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

export { uniV32Mapping, uniV3Mapping }
