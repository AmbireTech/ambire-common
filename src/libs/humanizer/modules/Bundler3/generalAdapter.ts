import { Interface, ZeroAddress } from 'ethers'

import { GeneralAdapter1 } from '../../const/abis/GeneralAdapter1'
import { HumanizerVisualization, HumanizerWarning, IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getBreak,
  getLabel,
  getToken,
  getUnwrapping,
  getWarning,
  getWrapping
} from '../../utils'

export const generalAdapterInterface = new Interface(GeneralAdapter1)

export interface BundleCall {
  to: string
  data: string
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

const toRepayAssets = (assets: bigint, shares: bigint, maxSharePriceE27: bigint): bigint => {
  if (assets > 0n) return assets
  if (shares <= 0n || maxSharePriceE27 <= 0n) return assets

  const precision = 10n ** 27n
  return (shares * maxSharePriceE27 + precision - 1n) / precision
}

const matcher: Record<string, (accAddr: string, call: IrCall) => IrCall | undefined> = {
  [generalAdapterInterface.getFunction('erc20TransferFrom')?.selector!]: (
    _accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { token, receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [
      getBreak(),
      getAction('Transfer'),
      getToken(token, amount),
      getLabel('To'),
      getAddressVisualization(receiver)
    ]
    return { ...call, fullVisualization }
  },
  [generalAdapterInterface.getFunction('erc20Transfer')?.selector!]: (
    _accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { token, receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [
      getBreak(),
      getAction('Transfer'),
      getToken(token, amount),
      getLabel('To'),
      getAddressVisualization(receiver)
    ]
    return { ...call, fullVisualization }
  },
  [generalAdapterInterface.getFunction('nativeTransfer')?.selector!]: (
    _accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [
      getBreak(),
      getAction('Transfer'),
      getToken(ZeroAddress, amount),
      getLabel('To'),
      getAddressVisualization(receiver)
    ]
    return { ...call, fullVisualization }
  },
  [generalAdapterInterface.getFunction('wrapNative')?.selector!]: (
    _accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { amount } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [getBreak(), ...getWrapping(ZeroAddress, amount)]
    return { ...call, fullVisualization }
  },
  [generalAdapterInterface.getFunction('unwrapNative')?.selector!]: (
    _accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { amount } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [getBreak(), ...getUnwrapping(ZeroAddress, amount)]
    return { ...call, fullVisualization }
  },
  [generalAdapterInterface.getFunction('permit2TransferFrom')?.selector!]: (
    _accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { token, receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [
      getBreak(),
      getAction('Transfer'),
      getToken(token, amount),
      getLabel('To'),
      getAddressVisualization(receiver)
    ]
    return { ...call, fullVisualization }
  },
  [generalAdapterInterface.getFunction('morphoSupplyCollateral')?.selector!]: (
    accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { marketParams, assets, onBehalf } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [getBreak(), getAction('Supply'), getToken(marketParams[1], assets)]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, onBehalf) }
  },
  [generalAdapterInterface.getFunction('morphoBorrow')?.selector!]: (
    accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { marketParams, assets, receiver } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [getBreak(), getAction('Borrow'), getToken(marketParams[0], assets)]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  },
  [generalAdapterInterface.getFunction('morphoRepay')?.selector!]: (
    accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { marketParams, assets, shares, maxSharePriceE27, onBehalf } =
      generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [
      getBreak(),
      getAction('Repay'),
      getToken(marketParams[0], toRepayAssets(assets, shares, maxSharePriceE27))
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, onBehalf) }
  },
  [generalAdapterInterface.getFunction('morphoWithdrawCollateral')?.selector!]: (
    accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { marketParams, assets, receiver } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [getBreak(), getAction('Withdraw'), getToken(marketParams[1], assets)]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  },
  [generalAdapterInterface.getFunction('morphoFlashLoan')?.selector!]: (
    _accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { token, assets } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [
      getBreak(),
      getAction('Execute flash loan for'),
      getToken(token, assets)
    ]
    return { ...call, fullVisualization }
  },
  [generalAdapterInterface.getFunction('erc4626Mint')?.selector!]: (
    accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { vault, receiver } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [
      getBreak(),
      getAction('Supply to vault'),
      getAddressVisualization(vault)
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  },
  [generalAdapterInterface.getFunction('erc4626Deposit')?.selector!]: (
    accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { vault, receiver } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [
      getBreak(),
      getAction('Mint from vault'),
      getAddressVisualization(vault)
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  },
  [generalAdapterInterface.getFunction('erc4626Withdraw')?.selector!]: (
    accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { vault, receiver } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [
      getBreak(),
      getAction('Withdraw from vault'),
      getAddressVisualization(vault)
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  },
  [generalAdapterInterface.getFunction('erc4626Redeem')?.selector!]: (
    accAddr: string,
    call: IrCall
  ): IrCall | undefined => {
    const { vault, receiver } = generalAdapterInterface.parseTransaction(call)!.args
    const fullVisualization = [
      getBreak(),
      getAction('Withdraw from vault'),
      getAddressVisualization(vault)
    ]
    return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
  }
}

export const decodeGeneralAdapterCall = (accAddr: string, call: IrCall): IrCall => {
  const match = matcher[call.data.slice(0, 10)]
  if (!match) return call

  try {
    return match(accAddr, call) || call
  } catch (error) {
    console.error('Failed to decode GeneralAdapter1 calldata', error)
    return call
  }
}

export const decodeGeneralAdapter = (accAddr: string, bundle: BundleCall[]) =>
  bundle.map((call) => decodeGeneralAdapterCall(accAddr, call))
