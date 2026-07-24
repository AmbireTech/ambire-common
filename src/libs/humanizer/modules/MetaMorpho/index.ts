import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getBreak,
  getLabel,
  getOnBehalfOf,
  getToken,
  HexIrCall,
  isHexCall
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
}

// inner calls not matching one of these selectors are rendered as "Unknown call" rather
// than dropping the whole multicall's humanization
const innerCallMatcher: Record<
  string,
  (vault: string, accAddr: string, data: HexIrCall['data']) => HumanizerVisualization[]
> = {
  [toFunctionSelector(erc20ApproveAbi[0])]: (vault, _accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc20ApproveAbi, data })
    const [spender, amount] = args
    return amount !== 0n
      ? [
          getAction('Grant approval'),
          getLabel('for'),
          getToken(vault, amount),
          getLabel('to'),
          getAddressVisualization(spender)
        ]
      : [
          getAction('Revoke approval'),
          getToken(vault, amount),
          getLabel('for'),
          getAddressVisualization(spender)
        ]
  },
  [toFunctionSelector(permitAbi[0])]: (vault, accAddr, data) => {
    const { args } = decodeFunctionData({ abi: permitAbi, data })
    const [owner, spender, value] = args
    return [
      getAction('Grant approval'),
      getLabel('for'),
      getToken(vault, value),
      getLabel('to'),
      getAddressVisualization(spender),
      ...getOnBehalfOf(owner, accAddr)
    ]
  },
  [toFunctionSelector(erc20TransferAbi[0])]: (vault, _accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc20TransferAbi, data })
    const [to, amount] = args
    return [getAction('Send'), getToken(vault, amount), getLabel('to'), getAddressVisualization(to)]
  },
  [toFunctionSelector(erc20TransferFromAbi[0])]: (vault, _accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc20TransferFromAbi, data })
    const [from, to, amount] = args
    return [
      getAction('Transfer'),
      getToken(vault, amount),
      getLabel('from'),
      getAddressVisualization(from),
      getLabel('to'),
      getAddressVisualization(to)
    ]
  },
  [toFunctionSelector(erc4626DepositAbi[0])]: (vault, accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc4626DepositAbi, data })
    const [assets, receiver] = args
    return [
      getAction('Deposit into vault'),
      getToken(vault, assets),
      ...getOnBehalfOf(receiver, accAddr)
    ]
  },
  [toFunctionSelector(erc4626MintAbi[0])]: (vault, accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc4626MintAbi, data })
    const [shares, receiver] = args
    return [
      getAction('Mint vault shares'),
      getToken(vault, shares),
      ...getOnBehalfOf(receiver, accAddr)
    ]
  },
  [toFunctionSelector(erc4626WithdrawAbi[0])]: (vault, accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc4626WithdrawAbi, data })
    const [assets, , owner] = args
    return [
      getAction('Withdraw from vault'),
      getToken(vault, assets),
      ...getOnBehalfOf(owner, accAddr)
    ]
  },
  [toFunctionSelector(erc4626RedeemAbi[0])]: (vault, accAddr, data) => {
    const { args } = decodeFunctionData({ abi: erc4626RedeemAbi, data })
    const [shares, , owner] = args
    return [
      getAction('Redeem vault shares'),
      getToken(vault, shares),
      ...getOnBehalfOf(owner, accAddr)
    ]
  }
}

const unmatched = (): DecodedInnerCall => ({
  visualization: [getAction('Unknown call')],
  matched: false
})

const decodeVaultMulticall = (
  vault: string,
  accAddr: string,
  innerCalls: readonly HexIrCall['data'][]
): DecodedInnerCall[] =>
  innerCalls.map((data) => {
    const decodeInnerCall = innerCallMatcher[data.slice(0, 10)]
    if (!decodeInnerCall) return unmatched()
    try {
      return { visualization: decodeInnerCall(vault, accAddr, data), matched: true }
    } catch (error) {
      console.error('Failed to decode MetaMorpho inner call', error)
      return unmatched()
    }
  })

const humanizeCall = (accOp: AccountOp, call: IrCall): IrCall => {
  if (call.fullVisualization) return call
  if (!call.to) return call
  if (!isHexCall(call)) return call
  if (call.data.slice(0, 10) !== toFunctionSelector(multicallAbi[0])) return call

  const { args } = decodeFunctionData({ abi: multicallAbi, data: call.data })
  const [innerCalls] = args
  if (!innerCalls.length) return call
  const decoded: DecodedInnerCall[] = decodeVaultMulticall(call.to, accOp.accountAddr, innerCalls)

  // require at least one recognized vault action before claiming this call - otherwise this
  // is some other protocol's unrelated multicall(bytes[]) (e.g. Uniswap's router) and should
  // be left for other modules / the fallback humanizer
  if (!decoded.some((c) => c.matched)) return call

  const fullVisualization = decoded.flatMap((c) => [getBreak(), ...c.visualization])
  fullVisualization.shift()

  return { ...call, fullVisualization }
}

const MetaMorphoModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]): IrCall[] =>
  calls.map((call) => humanizeCall(accOp, call))

export default MetaMorphoModule
