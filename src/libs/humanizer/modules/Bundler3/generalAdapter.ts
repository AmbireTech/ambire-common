import { decodeFunctionData, parseAbi, toFunctionSelector, zeroAddress } from 'viem'

import { HumanizerVisualization, HumanizerWarning, IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getBreak,
  getLabel,
  getToken,
  getUnwrapping,
  getWarning,
  getWrapping,
  HexIrCall,
  isHexCall
} from '../../utils'

export const erc20TransferFromAbi = parseAbi([
  'function erc20TransferFrom(address token, address receiver, uint256 amount)'
])
export const erc20TransferAbi = parseAbi([
  'function erc20Transfer(address token, address receiver, uint256 amount)'
])
export const nativeTransferAbi = parseAbi([
  'function nativeTransfer(address receiver, uint256 amount)'
])
export const wrapNativeAbi = parseAbi(['function wrapNative(uint256 amount)'])
export const unwrapNativeAbi = parseAbi(['function unwrapNative(uint256 amount)'])
export const permit2TransferFromAbi = parseAbi([
  'function permit2TransferFrom(address token, address receiver, uint256 amount)'
])
export const morphoSupplyCollateralAbi = parseAbi([
  'function morphoSupplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)'
])
export const morphoBorrowAbi = parseAbi([
  'function morphoBorrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, uint256 minSharePriceE27, address receiver)'
])
export const morphoRepayAbi = parseAbi([
  'function morphoRepay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, uint256 maxSharePriceE27, address onBehalf, bytes data)'
])
export const morphoWithdrawCollateralAbi = parseAbi([
  'function morphoWithdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address receiver)'
])
export const morphoFlashLoanAbi = parseAbi([
  'function morphoFlashLoan(address token, uint256 assets, bytes data)'
])
export const erc4626MintAbi = parseAbi([
  'function erc4626Mint(address vault, uint256 shares, uint256 maxSharePriceE27, address receiver)'
])
export const erc4626DepositAbi = parseAbi([
  'function erc4626Deposit(address vault, uint256 assets, uint256 maxSharePriceE27, address receiver)'
])
export const erc4626WithdrawAbi = parseAbi([
  'function erc4626Withdraw(address vault, uint256 assets, uint256 minSharePriceE27, address receiver, address owner)'
])
export const erc4626RedeemAbi = parseAbi([
  'function erc4626Redeem(address vault, uint256 shares, uint256 minSharePriceE27, address receiver, address owner)'
])

export interface BundleCall {
  to: string
  data: string
  value: bigint
  skipRevert: boolean
  callbackHash: string
  fullVisualization?: HumanizerVisualization[]
  warnings?: HumanizerWarning[]
}

export const getWarnings = (accAddr: string, onBehalf: string): HumanizerWarning[] => {
  return onBehalf.toLowerCase() !== accAddr.toLowerCase()
    ? [
        getWarning(
          `Differnt action address detected! Owner is ${accAddr}, while action address is ${onBehalf}`,
          'Morpho_diff_addr'
        )
      ]
    : []
}

const toRepayAssets = (assets: bigint, shares: bigint, maxSharePriceE27: bigint): bigint => {
  if (assets > 0n) return assets
  if (shares <= 0n || maxSharePriceE27 <= 0n) return assets

  const precision = 10n ** 27n
  return (shares * maxSharePriceE27 + precision - 1n) / precision
}

const matcher: Record<string, (accAddr: string, call: HexIrCall) => IrCall | undefined> = {
  [toFunctionSelector(erc20TransferFromAbi[0])]: (
    _accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: erc20TransferFromAbi, data: call.data })
    const [token, receiver, amount] = args
    const fullVisualization = [
      getBreak(),
      getAction('Transfer'),
      getToken(token, amount),
      getLabel('To'),
      getAddressVisualization(receiver)
    ]
    return { ...call, fullVisualization }
  },
  [toFunctionSelector(erc20TransferAbi[0])]: (
    _accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: erc20TransferAbi, data: call.data })
    const [token, receiver, amount] = args
    const fullVisualization = [
      getBreak(),
      getAction('Transfer'),
      getToken(token, amount),
      getLabel('To'),
      getAddressVisualization(receiver)
    ]
    return { ...call, fullVisualization }
  },
  [toFunctionSelector(nativeTransferAbi[0])]: (
    _accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: nativeTransferAbi, data: call.data })
    const [receiver, amount] = args
    const fullVisualization = [
      getBreak(),
      getAction('Transfer'),
      getToken(zeroAddress, amount),
      getLabel('To'),
      getAddressVisualization(receiver)
    ]
    return { ...call, fullVisualization }
  },
  [toFunctionSelector(wrapNativeAbi[0])]: (
    _accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: wrapNativeAbi, data: call.data })
    const [amount] = args
    const fullVisualization = [getBreak(), ...getWrapping(zeroAddress, amount)]
    return { ...call, fullVisualization }
  },
  [toFunctionSelector(unwrapNativeAbi[0])]: (
    _accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: unwrapNativeAbi, data: call.data })
    const [amount] = args
    const fullVisualization = [getBreak(), ...getUnwrapping(zeroAddress, amount)]
    return { ...call, fullVisualization }
  },
  [toFunctionSelector(permit2TransferFromAbi[0])]: (
    _accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: permit2TransferFromAbi, data: call.data })
    const [token, receiver, amount] = args
    const fullVisualization = [
      getBreak(),
      getAction('Transfer'),
      getToken(token, amount),
      getLabel('To'),
      getAddressVisualization(receiver)
    ]
    return { ...call, fullVisualization }
  },
  [toFunctionSelector(morphoSupplyCollateralAbi[0])]: (
    accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: morphoSupplyCollateralAbi, data: call.data })
    const [marketParams, assets, onBehalf] = args
    const fullVisualization = [
      getBreak(),
      getAction('Supply'),
      getToken(marketParams.collateralToken, assets)
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, onBehalf) }
  },
  [toFunctionSelector(morphoBorrowAbi[0])]: (
    accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: morphoBorrowAbi, data: call.data })
    const [marketParams, assets, , , receiver] = args
    const fullVisualization = [
      getBreak(),
      getAction('Borrow'),
      getToken(marketParams.loanToken, assets)
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  },
  [toFunctionSelector(morphoRepayAbi[0])]: (
    accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: morphoRepayAbi, data: call.data })
    const [marketParams, assets, shares, maxSharePriceE27, onBehalf] = args
    const fullVisualization = [
      getBreak(),
      getAction('Repay'),
      getToken(marketParams.loanToken, toRepayAssets(assets, shares, maxSharePriceE27))
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, onBehalf) }
  },
  [toFunctionSelector(morphoWithdrawCollateralAbi[0])]: (
    accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: morphoWithdrawCollateralAbi, data: call.data })
    const [marketParams, assets, receiver] = args
    const fullVisualization = [
      getBreak(),
      getAction('Withdraw'),
      getToken(marketParams.collateralToken, assets)
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  },
  [toFunctionSelector(morphoFlashLoanAbi[0])]: (
    _accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: morphoFlashLoanAbi, data: call.data })
    const [token, assets] = args
    const fullVisualization = [
      getBreak(),
      getAction('Execute flash loan for'),
      getToken(token, assets)
    ]
    return { ...call, fullVisualization }
  },
  [toFunctionSelector(erc4626MintAbi[0])]: (
    accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: erc4626MintAbi, data: call.data })
    const [vault, , , receiver] = args
    const fullVisualization = [
      getBreak(),
      getAction('Supply to vault'),
      getAddressVisualization(vault)
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  },
  [toFunctionSelector(erc4626DepositAbi[0])]: (
    accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: erc4626DepositAbi, data: call.data })
    const [vault, , , receiver] = args
    const fullVisualization = [
      getBreak(),
      getAction('Mint from vault'),
      getAddressVisualization(vault)
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  },
  [toFunctionSelector(erc4626WithdrawAbi[0])]: (
    accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: erc4626WithdrawAbi, data: call.data })
    const [vault, , , receiver] = args
    const fullVisualization = [
      getBreak(),
      getAction('Withdraw from vault'),
      getAddressVisualization(vault)
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  },
  [toFunctionSelector(erc4626RedeemAbi[0])]: (
    accAddr: string,
    call: HexIrCall
  ): IrCall | undefined => {
    const { args } = decodeFunctionData({ abi: erc4626RedeemAbi, data: call.data })
    const [vault, , , receiver] = args
    const fullVisualization = [
      getBreak(),
      getAction('Withdraw from vault'),
      getAddressVisualization(vault)
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  }
}

export const decodeGeneralAdapterCall = (accAddr: string, call: IrCall): IrCall => {
  if (!isHexCall(call)) return call

  const match = matcher[call.data.slice(0, 10)]
  if (!match) return call

  try {
    return match(accAddr, call) || call
  } catch (error) {
    console.error('Failed to decode GeneralAdapter calldata', error)
    return call
  }
}

export const decodeGeneralAdapter = (accAddr: string, bundle: BundleCall[]) =>
  bundle.map((call) => decodeGeneralAdapterCall(accAddr, call))
