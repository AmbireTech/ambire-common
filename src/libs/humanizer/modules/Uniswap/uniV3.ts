/* eslint-disable no-console */
import { ethers } from 'ethers'
import {
  getAction,
  getLabel,
  getToken,
  getRecipientText,
  getAddress,
  getDeadlineText,
  getUnknownVisualization
} from '../../utils'

import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
import { parsePath } from './utils'

// Stolen from ambire-wallet
const uniV32Mapping = (
  humanizerInfo: any
): { [key: string]: (a: AccountOp, c: IrCall) => IrCall[] } => {
  const ifaceV32 = new ethers.Interface(humanizerInfo?.['abis:UniV3Router2'])
  return {
    // uint256 is deadline
    // 0x5ae401dc
    [ifaceV32.getFunction('multicall(uint256,bytes[])')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [deadline, calls] = ifaceV32.parseTransaction(call)?.args || []
      const mappingResult = uniV32Mapping(humanizerInfo)
      const parsed: IrCall[] = calls
        .map((data: string): IrCall[] => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : []
        })
        .flat()
        .map(
          (newCall: IrCall): IrCall => ({
            ...newCall,
            fullVisualization: [...(newCall.fullVisualization || []), getDeadlineText(deadline)]
          })
        )
        .filter((x: any) => x)
      return parsed.length
        ? parsed
        : [{ ...call, fullVisualization: getUnknownVisualization('Uni V3', call) }]
    },
    // 0xac9650d8
    [ifaceV32.getFunction('multicall(bytes[])')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [calls] = ifaceV32.parseTransaction(call)?.args || []
      const mappingResult = uniV32Mapping(humanizerInfo)
      const parsed = calls
        .map((data: string) => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : null
        })
        .flat()
        .filter((x: any) => x)
      return parsed.length
        ? parsed
        : [{ ...call, fullVisualization: getUnknownVisualization('Uni V3', call) }]
    },
    // bytes32 is prevBlockHash
    // 0x1f0464d1
    [ifaceV32.getFunction('multicall(bytes32, bytes[])')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [prevBlockHash, calls] = ifaceV32.parseTransaction(call)?.args || []
      const mappingResult = uniV32Mapping(humanizerInfo)
      const parsed = calls
        .map((data: string) => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : null
        })
        .map((newCall: IrCall) => {
          return {
            ...newCall,
            fullVisualization: [
              ...(newCall.fullVisualization || []),
              getLabel(`after block ${prevBlockHash}`)
            ]
          }
        })
        .flat()
        .filter((x: any) => x)
      return parsed.length
        ? parsed
        : [
            {
              ...call,
              fullVisualization: [
                ...getUnknownVisualization('Uni V3', call),
                getLabel(`after block ${prevBlockHash}`)
              ]
            }
          ]
    },
    // NOTE: selfPermit is not supported cause it requires an ecrecover signature
    // 0x04e45aaf
    [ifaceV32.getFunction('exactInputSingle')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      // @TODO: consider fees
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getToken(params.tokenIn, params.amountIn),
            getLabel('for at least'),
            getToken(params.tokenOut, params.amountOutMinimum),
            ...getRecipientText(accountOp.accountAddr, params.recipient)
          ]
        }
      ]
    },
    // 0xb858183f
    [ifaceV32.getFunction('exactInput')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getToken(path[0], params.amountIn),
            getLabel('for at least'),
            getToken(path[path.length - 1], params.amountOutMinimum),
            ...getRecipientText(accountOp.accountAddr, params.recipient)
          ]
        }
      ]
    },
    // 0x5023b4df
    [ifaceV32.getFunction('exactOutputSingle')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap up to'),
            getToken(params.tokenIn, params.amountInMaximum),
            getLabel('for'),
            getToken(params.tokenOut, params.amountOut),
            ...getRecipientText(accountOp.accountAddr, params.recipient)
          ]
        }
      ]
    },
    // 0x09b81346
    [ifaceV32.getFunction('exactOutput')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap up to'),
            getToken(path[path.length - 1], params.amountInMaximum),
            getLabel('for'),
            getToken(path[0], params.amountOut),
            ...getRecipientText(accountOp.accountAddr, params.recipient)
          ]
        }
      ]
    },
    // 0x42712a67
    [ifaceV32.getFunction('swapTokensForExactTokens')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [amountOut, amountInMax, path, to] = ifaceV32.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap up to'),
            getToken(path[0], amountInMax),
            getLabel('for'),
            getToken(path[path.length - 1], amountOut),
            ...getRecipientText(accountOp.accountAddr, to)
          ]
        }
      ]
    },
    // 0x472b43f3
    [ifaceV32.getFunction('swapExactTokensForTokens')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [amountIn, amountOutMin, path, to] = ifaceV32.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getToken(path[0], amountIn),
            getLabel('for at least'),
            getToken(path[path.length - 1], amountOutMin),
            ...getRecipientText(accountOp.accountAddr, to)
          ]
        }
      ]
    },
    // 0x49616997
    [ifaceV32.getFunction('unwrapWETH9(uint256)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [amountMin] = ifaceV32.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [getAction('Unwrap'), getToken(ethers.ZeroAddress, amountMin)]
        }
      ]
    },
    // address is recipient
    // 0x49404b7c
    [ifaceV32.getFunction('unwrapWETH9(uint256,address)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [amountMin, recipient] = ifaceV32.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Unwrap'),
            getToken(ethers.ZeroAddress, amountMin),
            ...getRecipientText(accountOp.accountAddr, recipient)
          ]
        }
      ]
    },
    // 0xe90a182f
    [ifaceV32.getFunction('sweepToken(address,uint256)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [token, amountMinimum] = ifaceV32.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Sweep'),
            getLabel('at least'),
            getToken(token, amountMinimum)
          ]
        }
      ]
    },
    // 0xdf2ab5bb
    [ifaceV32.getFunction('sweepToken(address,uint256,address)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [token, amountMinimum, recipient] = ifaceV32.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Sweep'),
            getLabel('at least'),
            getToken(token, amountMinimum),
            ...getRecipientText(accountOp.accountAddr, recipient)
          ]
        }
      ]
    },
    // 0x3068c554
    [ifaceV32.getFunction('sweepTokenWithFee(address,uint256,uint256,address)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [token, amountMinimum, feeBips, feeRecipient] =
        ifaceV32.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Sweep'),
            getLabel('at least'),
            getToken(token, amountMinimum),
            getLabel('with fee'),
            getToken(token, feeBips),
            getLabel('to'),
            getAddress(feeRecipient)
          ]
        }
      ]
    },
    // 0xe0e189a0
    [`${
      ifaceV32.getFunction('sweepTokenWithFee(address,uint256,address,uint256,address)')?.selector
    }`]: (accountOp: AccountOp, call: IrCall): IrCall[] => {
      const [token, amountMinimum, recipient, feeBips, feeRecipient] =
        ifaceV32.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Sweep'),
            getLabel('at least'),
            getToken(token, amountMinimum),
            getLabel('with fee'),
            getToken(token, feeBips),
            getLabel('to'),
            getAddress(feeRecipient),
            ...getRecipientText(accountOp.accountAddr, recipient)
          ]
        }
      ]
    }
  }
}

const uniV3Mapping = (
  humanizerInfo: any
): { [key: string]: (a: AccountOp, c: IrCall) => IrCall[] } => {
  const ifaceV3 = new ethers.Interface(humanizerInfo?.['abis:UniV3Router'])
  return {
    // 0xac9650d8
    [ifaceV3.getFunction('multicall')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const args = ifaceV3.parseTransaction(call)?.args || []
      const calls = args[args.length - 1]
      const mappingResult = uniV3Mapping(humanizerInfo)
      const parsed = calls
        .map((data: string) => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : null
        })
        .flat()
        .filter((x: any) => x)
      return parsed.length
        ? parsed
        : [{ ...call, fullVisualization: getUnknownVisualization('Uni V3', call) }]
    },
    // NOTE: selfPermit is not supported cause it requires an ecrecover signature
    // 0x414bf389
    [ifaceV3.getFunction('exactInputSingle')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      // @TODO: consider fees
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getToken(params.tokenIn, params.amountIn),
            getLabel('for at least'),
            getToken(params.tokenOut, params.amountOutMinimum),
            ...getRecipientText(accountOp.accountAddr, params.recipient),
            getDeadlineText(params.deadline)
          ]
        }
      ]
    },
    // 0xc04b8d59
    [ifaceV3.getFunction('exactInput')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getToken(path[0], params.amountIn),
            getLabel('for at least'),
            getToken(path[path.length - 1], params.amountOutMinimum),
            ...getRecipientText(accountOp.accountAddr, params.recipient),
            getDeadlineText(params.deadline)
          ]
        }
      ]
    },
    // 0xdb3e2198
    [ifaceV3.getFunction('exactOutputSingle')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap up to'),
            getToken(params.tokenIn, params.amountInMaximum),
            getLabel('for'),
            getToken(params.tokenOut, params.amountOut),
            ...getRecipientText(accountOp.accountAddr, params.recipient),
            getDeadlineText(params.deadline)
          ]
        }
      ]
    },
    // 0xf28c0498
    [ifaceV3.getFunction('exactOutput')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap up to'),
            getToken(path[path.length - 1], params.amountInMaximum),
            getLabel('for'),
            getToken(path[0], params.amountOut),
            ...getRecipientText(accountOp.accountAddr, params.recipient),
            getDeadlineText(params.deadline)
          ]
        }
      ]
    },
    // 0x49404b7c
    [ifaceV3.getFunction('unwrapWETH9')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [amountMin, recipient] = ifaceV3.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Unwrap'),
            getToken(ethers.ZeroAddress, amountMin),
            ...getRecipientText(accountOp.accountAddr, recipient)
          ]
        }
      ]
    },
    // 0x9b2c0a37
    [ifaceV3.getFunction('unwrapWETH9WithFee')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [amountMin, recipient, feeBips, feeRecipient] =
        ifaceV3.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Unwrap'),
            getToken(ethers.ZeroAddress, amountMin),
            getLabel('with fee'),
            getToken(ethers.ZeroAddress, feeBips),
            getLabel('to'),
            getAddress(feeRecipient),
            ...getRecipientText(accountOp.accountAddr, recipient)
          ]
        }
      ]
    },
    // 0x12210e8a
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    [ifaceV3.getFunction('refundETH()')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      return [{ ...call, fullVisualization: [getAction('Refund')] }]
    }
  }
}

export { uniV32Mapping, uniV3Mapping }
