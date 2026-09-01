import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall
} from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getBreak,
  getLabel,
  getOnBehalfOf,
  getToken,
  getUnlimitedApprovalWarning,
  HexIrCall,
  isHexCall,
  isUnlimitedAmount,
  mergeWarnings,
  padCallData
} from '../../utils'

// MetaMorpho vaults are ERC-4626 + ERC-20 + ERC-2612 (permit) + OZ Multicall contracts.
// Users batch several actions on the vault itself (e.g. approve + deposit) through
// the vault's own `multicall(bytes[])`, so every inner call targets the vault (call.to).
const multicallAbi = parseAbi([
  'function multicall(bytes[] data) payable returns (bytes[] results)'
])

const erc20ApproveAbi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)'
])
const erc20TransferAbi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])
const erc20TransferFromAbi = parseAbi([
  'function transferFrom(address from, address to, uint256 amount) returns (bool)'
])
const permitAbi = parseAbi([
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)'
])
const erc4626DepositAbi = parseAbi([
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)'
])
const erc4626MintAbi = parseAbi([
  'function mint(uint256 shares, address receiver) returns (uint256 assets)'
])
const erc4626WithdrawAbi = parseAbi([
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)'
])
const erc4626RedeemAbi = parseAbi([
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)'
])

interface DecodedInnerCall {
  visualization: HumanizerVisualization[]
  matched: boolean
  // collected while the inner call is decoded, e.g. when it turns out to be an approval with
  // no limit. A nested bundle carries up every warning the calls inside it produced
  warnings: HumanizerWarning[]
}

// inner calls not matching one of these selectors are rendered as "Unknown call" rather
// than dropping the whole multicall's humanization
type DecodedInnerCallResult = {
  visualization: HumanizerVisualization[]
  warning?: HumanizerWarning
}

const innerCallMatcher: Record<
  string,
  (vault: string, accAddr: string, data: HexIrCall['data']) => DecodedInnerCallResult
> = {
  [toFunctionSelector(erc20ApproveAbi[0])]: (vault, _accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc20ApproveAbi, data: padCallData(data, 2) })
    const [spender, amount] = args
    if (amount === 0n)
      return {
        visualization: [
          getAction('Revoke approval'),
          getToken(vault, amount),
          getLabel('for'),
          getAddressVisualization(spender)
        ]
      }

    return {
      visualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(vault, amount),
        getLabel('to'),
        getAddressVisualization(spender)
      ],
      warning: isUnlimitedAmount(amount) ? getUnlimitedApprovalWarning(spender) : undefined
    }
  },
  [toFunctionSelector(permitAbi[0])]: (vault, accAddr, data) => {
    const { args } = decodeFunctionData({ abi: permitAbi, data: padCallData(data, 7) })
    const [owner, spender, value] = args
    return {
      visualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(vault, value),
        getLabel('to'),
        getAddressVisualization(spender),
        ...getOnBehalfOf(owner, accAddr)
      ],
      warning: isUnlimitedAmount(value) ? getUnlimitedApprovalWarning(spender) : undefined
    }
  },
  [toFunctionSelector(erc20TransferAbi[0])]: (vault, _accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc20TransferAbi, data: padCallData(data, 2) })
    const [to, amount] = args
    return {
      visualization: [
        getAction('Send'),
        getToken(vault, amount),
        getLabel('to'),
        getAddressVisualization(to)
      ]
    }
  },
  [toFunctionSelector(erc20TransferFromAbi[0])]: (vault, _accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc20TransferFromAbi, data: padCallData(data, 3) })
    const [from, to, amount] = args
    return {
      visualization: [
        getAction('Transfer'),
        getToken(vault, amount),
        getLabel('from'),
        getAddressVisualization(from),
        getLabel('to'),
        getAddressVisualization(to)
      ]
    }
  },
  [toFunctionSelector(erc4626DepositAbi[0])]: (vault, accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc4626DepositAbi, data: padCallData(data, 2) })
    const [assets, receiver] = args
    return {
      visualization: [
        getAction('Deposit into vault'),
        getToken(vault, assets),
        ...getOnBehalfOf(receiver, accAddr)
      ]
    }
  },
  [toFunctionSelector(erc4626MintAbi[0])]: (vault, accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc4626MintAbi, data: padCallData(data, 2) })
    const [shares, receiver] = args
    return {
      visualization: [
        getAction('Mint vault shares'),
        getToken(vault, shares),
        ...getOnBehalfOf(receiver, accAddr)
      ]
    }
  },
  [toFunctionSelector(erc4626WithdrawAbi[0])]: (vault, accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc4626WithdrawAbi, data: padCallData(data, 3) })
    const [assets, , owner] = args
    return {
      visualization: [
        getAction('Withdraw from vault'),
        getToken(vault, assets),
        ...getOnBehalfOf(owner, accAddr)
      ]
    }
  },
  [toFunctionSelector(erc4626RedeemAbi[0])]: (vault, accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc4626RedeemAbi, data: padCallData(data, 3) })
    const [shares, , owner] = args
    return {
      visualization: [
        getAction('Redeem vault shares'),
        getToken(vault, shares),
        ...getOnBehalfOf(owner, accAddr)
      ]
    }
  }
}

// shown as unknown without a warning on purpose: `multicall(bytes[])` is not unique to
// MetaMorpho, so an inner selector this module does not know may be an ordinary call on some
// other contract. Warning here would alarm users about calls that are not a real concern
const unmatched = (): DecodedInnerCall => ({
  visualization: [getAction('Unknown call')],
  matched: false,
  warnings: []
})

const multicallSelector = toFunctionSelector(multicallAbi[0])

const joinWithBreaks = (decoded: DecodedInnerCall[]): HumanizerVisualization[] => {
  const visualization = decoded.flatMap((c) => [getBreak(), ...c.visualization])
  visualization.shift()

  return visualization
}

// No depth limit here on purpose: every nested bundle's calldata is part of its parent
// bundle's calldata, so it is always shorter and the recursion always stops on its own. A
// depth limit would just hide a deeply nested approval's warning from the user instead.
const decodeVaultMulticall = (
  vault: string,
  accAddr: string,
  innerCalls: readonly HexIrCall['data'][]
): DecodedInnerCall[] =>
  innerCalls.map((data) => {
    const selector = data.slice(0, 10)

    if (selector === multicallSelector) {
      try {
        const { args } = decodeFunctionData({ abi: multicallAbi, data })
        const [nestedCalls] = args
        if (!nestedCalls.length) return unmatched()
        const nested = decodeVaultMulticall(vault, accAddr, nestedCalls)
        if (!nested.some((c) => c.matched)) return unmatched()

        return {
          visualization: joinWithBreaks(nested),
          matched: true,
          warnings: nested.flatMap((c) => c.warnings)
        }
      } catch (error) {
        console.error('Failed to decode nested MetaMorpho multicall', error)
        return unmatched()
      }
    }

    const decodeInnerCall = innerCallMatcher[selector]
    if (!decodeInnerCall) return unmatched()
    try {
      const { visualization, warning } = decodeInnerCall(vault, accAddr, data)

      return { visualization, matched: true, warnings: warning ? [warning] : [] }
    } catch (error) {
      console.error('Failed to decode MetaMorpho inner call', error)
      return unmatched()
    }
  })

const MetaMorphoModule: HumanizerCallModule = (accOp: AccountOp, call: IrCall): IrCall => {
  if (call.fullVisualization) return call
  if (!call.to) return call
  if (!isHexCall(call)) return call
  if (call.data.slice(0, 10) !== toFunctionSelector(multicallAbi[0])) return call

  let innerCalls: readonly HexIrCall['data'][]
  try {
    const { args } = decodeFunctionData({ abi: multicallAbi, data: call.data })
    ;[innerCalls] = args
  } catch (error) {
    console.error('Failed to decode MetaMorpho multicall', error)
    return call
  }
  if (!innerCalls.length) return call
  const decoded: DecodedInnerCall[] = decodeVaultMulticall(call.to, accOp.accountAddr, innerCalls)

  // require at least one recognized vault action before claiming this call - otherwise this
  // is some other protocol's unrelated multicall(bytes[]) (e.g. Uniswap's router) and should
  // be left for other modules / the fallback humanizer
  if (!decoded.some((c) => c.matched)) return call

  const fullVisualization = joinWithBreaks(decoded)
  const warnings = decoded.flatMap((c) => c.warnings)

  return { ...call, fullVisualization, warnings: mergeWarnings(call.warnings, warnings) }
}

export default MetaMorphoModule
