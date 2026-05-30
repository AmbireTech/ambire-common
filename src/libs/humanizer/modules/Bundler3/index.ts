/* eslint-disable @typescript-eslint/no-unused-vars */
import { decodeFunctionData, isHex, parseAbi, toFunctionSelector } from 'viem'

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
  getToken,
  getWarning,
  isHexCall
} from '../../utils'

const multicallAbi = [
  {
    type: 'function',
    name: 'multicall',
    inputs: [
      {
        name: 'bundle',
        type: 'tuple[]',
        internalType: 'tuple[]',
        components: [
          { name: 'to', type: 'address', internalType: 'address' },
          { name: 'data', type: 'bytes', internalType: 'bytes' },
          { name: 'value', type: 'uint256', internalType: 'uint256' },
          { name: 'skipRevert', type: 'bool', internalType: 'bool' },
          { name: 'callbackHash', type: 'bytes32', internalType: 'bytes32' }
        ]
      }
    ],
    outputs: [],
    stateMutability: 'payable'
  }
] as const
const morphoSupplyCollateralAbi = parseAbi([
  'function morphoSupplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)'
])
const morphoBorrowAbi = parseAbi([
  'function morphoBorrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, uint256 minSharePriceE27, address receiver)'
])
const morphoRepayAbi = parseAbi([
  'function morphoRepay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, uint256 maxSharePriceE27, address onBehalf, bytes data)'
])
const morphoWithdrawCollateralAbi = parseAbi([
  'function morphoWithdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address receiver)'
])
const morphoFlashLoanAbi = parseAbi([
  'function morphoFlashLoan(address token, uint256 assets, bytes data)'
])
const erc4626MintAbi = parseAbi([
  'function erc4626Mint(address vault, uint256 shares, uint256 maxSharePriceE27, address receiver)'
])
const erc4626DepositAbi = parseAbi([
  'function erc4626Deposit(address vault, uint256 assets, uint256 maxSharePriceE27, address receiver)'
])
const erc4626WithdrawAbi = parseAbi([
  'function erc4626Withdraw(address vault, uint256 assets, uint256 minSharePriceE27, address receiver, address owner)'
])
const erc4626RedeemAbi = parseAbi([
  'function erc4626Redeem(address vault, uint256 shares, uint256 minSharePriceE27, address receiver, address owner)'
])

interface BundleCall {
  to: string
  data: `0x${string}`
  value: bigint
  skipRevert: boolean
  callbackHash: string
  fullVisualization?: HumanizerVisualization[]
  warnings?: HumanizerWarning[]
}

const getWarnings = (accAddr: string, onBehalf: string): HumanizerWarning[] => {
  return onBehalf.toLowerCase() !== accAddr.toLowerCase()
    ? [
        getWarning(
          `Differnt action address detected! Owner is ${accAddr}, while action address is ${onBehalf}`,
          'Morpho_diff_addr'
        )
      ]
    : []
}

const decodeGeneralAdapter = (accAddr: string, bundle: readonly BundleCall[]) => {
  const matcher: { [sighash: string]: (call: BundleCall) => IrCall | undefined } = {
    // the below commented out humanizations are legit multicall humanizations
    // but they don't bring any value to the user other than confusion
    //
    // [toFunctionSelector(erc20TransferFromAbi[0])]: ...
    // [toFunctionSelector(erc20TransferAbi[0])]: ...
    // [toFunctionSelector(nativeTransferAbi[0])]: ...
    // [toFunctionSelector(wrapNativeAbi[0])]: ...
    // [toFunctionSelector(unwrapNativeAbi[0])]: ...
    // [toFunctionSelector(permit2TransferFromAbi[0])]: ...
    [toFunctionSelector(morphoSupplyCollateralAbi[0])]: (call) => {
      const { args } = decodeFunctionData({
        abi: morphoSupplyCollateralAbi,
        data: call.data
      })
      const [marketParams, assets, onBehalf] = args
      const collateral = marketParams.collateralToken
      const fullVisualization = [getBreak(), getAction('Supply'), getToken(collateral, assets)]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, onBehalf) }
    },
    [toFunctionSelector(morphoBorrowAbi[0])]: (call) => {
      const { args } = decodeFunctionData({
        abi: morphoBorrowAbi,
        data: call.data
      })
      const [marketParams, assets, , , receiver] = args
      const loanToken = marketParams.loanToken
      const fullVisualization = [
        getBreak(),
        getAction('Take'),
        getToken(loanToken, assets),
        getLabel('loan')
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
    },
    [toFunctionSelector(morphoRepayAbi[0])]: (call) => {
      const { args } = decodeFunctionData({
        abi: morphoRepayAbi,
        data: call.data
      })
      const [marketParams, assets, , , onBehalf] = args
      const loanToken = marketParams.loanToken
      const fullVisualization = [getBreak(), getAction('Repay'), getToken(loanToken, assets)]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, onBehalf) }
    },
    [toFunctionSelector(morphoWithdrawCollateralAbi[0])]: (call) => {
      const { args } = decodeFunctionData({
        abi: morphoWithdrawCollateralAbi,
        data: call.data
      })
      const [marketParams, assets, receiver] = args
      const collateralToken = marketParams.collateralToken
      const fullVisualization = [
        getBreak(),
        getAction('Withdraw'),
        getToken(collateralToken, assets)
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
    },
    [toFunctionSelector(morphoFlashLoanAbi[0])]: (call) => {
      const { args } = decodeFunctionData({
        abi: morphoFlashLoanAbi,
        data: call.data
      })
      const [token, assets] = args
      const fullVisualization = [
        getBreak(),
        getAction('Execute flash loan for'),
        getToken(token, assets)
      ]
      return { ...call, fullVisualization }
    },
    [toFunctionSelector(erc4626MintAbi[0])]: (call) => {
      const { args } = decodeFunctionData({
        abi: erc4626MintAbi,
        data: call.data
      })
      const [vault, , , receiver] = args
      const fullVisualization = [
        getBreak(),
        getAction('Supply to vault'),
        getAddressVisualization(vault)
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
    },
    [toFunctionSelector(erc4626DepositAbi[0])]: (call) => {
      const { args } = decodeFunctionData({
        abi: erc4626DepositAbi,
        data: call.data
      })
      const [vault, , , receiver] = args
      const fullVisualization = [
        getBreak(),
        getAction('Mint from vault'),
        getAddressVisualization(vault)
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
    },
    [toFunctionSelector(erc4626WithdrawAbi[0])]: (call) => {
      const { args } = decodeFunctionData({
        abi: erc4626WithdrawAbi,
        data: call.data
      })
      const [vault, , , receiver] = args
      const fullVisualization = [
        getBreak(),
        getAction('Withdraw from vault'),
        getAddressVisualization(vault)
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
    },
    [toFunctionSelector(erc4626RedeemAbi[0])]: (call) => {
      const { args } = decodeFunctionData({
        abi: erc4626RedeemAbi,
        data: call.data
      })
      const [vault, , , receiver] = args
      const fullVisualization = [
        getBreak(),
        getAction('Withdraw from vault'),
        getAddressVisualization(vault)
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
    }
  }

  return bundle.map((call) => {
    const match = matcher[call.data.slice(0, 10)]
    if (!match) return call
    const newCall = match(call)
    if (!newCall) return call
    return newCall
  })
}

const Bundler3Module: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]): IrCall[] => {
  const matcher: { [sighash: string]: (call: IrCall) => IrCall | undefined } = {
    [toFunctionSelector(multicallAbi[0])]: (call) => {
      if (!call.to) return
      if (call.value) return
      if (!isHexCall(call)) return
      const { args } = decodeFunctionData({ abi: multicallAbi, data: call.data })
      const [bundle] = args
      const decodedBundle = decodeGeneralAdapter(accOp.accountAddr, bundle)
      const bundleVisualization = decodedBundle.map((c) => c.fullVisualization || []).flat()
      if (bundleVisualization.length) bundleVisualization.shift()
      return {
        ...call,
        fullVisualization: bundleVisualization.length ? bundleVisualization : undefined
      }
    }
  }

  const newCalls = calls.map((call) => {
    const match = matcher[call.data.slice(0, 10)]
    if (call.fullVisualization || !match) return call
    const newCall = match(call)
    if (!newCall) return call
    return newCall
  })

  return newCalls
}

export default Bundler3Module
