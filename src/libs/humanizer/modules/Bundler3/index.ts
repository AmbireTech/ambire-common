/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { Bundler3 } from '../../const/abis/Bundler3'
import { GeneralAdapter1 } from '../../const/abis/GeneralAdapter1'
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
  getWarning
} from '../../utils'

const iface = new Interface(Bundler3)
const generalAdapterInterface = new Interface(GeneralAdapter1)

interface BundleCall {
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

const decodeGeneralAdapter = (accAddr: string, bundle: BundleCall[]) => {
  const matcher = {
    // the below commented out humanizations are legit multicall humanizations
    // but they don't bring any value to the user other than confusion
    //
    // [generalAdapterInterface.getFunction('erc20TransferFrom')?.selector!]: (
    //   call: IrCall
    // ): IrCall | undefined => {
    //   const { token, receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
    //   const fullVisualization = [
    //     getBreak(),
    //     getAction('Transfer'),
    //     getToken(token, amount),
    //     getLabel('To'),
    //     getAddressVisualization(receiver)
    //   ]
    //   return { ...call, fullVisualization }
    // },
    // [generalAdapterInterface.getFunction('erc20Transfer')?.selector!]: (
    //   call: IrCall
    // ): IrCall | undefined => {
    //   const { token, receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
    //   const fullVisualization = [
    //     getBreak(),
    //     getAction('Transfer'),
    //     getToken(token, amount),
    //     getLabel('To'),
    //     getAddressVisualization(receiver)
    //   ]
    //   return { ...call, fullVisualization }
    // },
    // [generalAdapterInterface.getFunction('nativeTransfer')?.selector!]: (
    //   call: IrCall
    // ): IrCall | undefined => {
    //   const { receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
    //   const fullVisualization = [
    //     getBreak(),
    //     getAction('Transfer'),
    //     getToken(ZeroAddress, amount),
    //     getLabel('To'),
    //     getAddressVisualization(receiver)
    //   ]
    //   return { ...call, fullVisualization }
    // },
    // [generalAdapterInterface.getFunction('wrapNative')?.selector!]: (
    //   call: IrCall
    // ): IrCall | undefined => {
    //   const { amount } = generalAdapterInterface.parseTransaction(call)!.args
    //   const fullVisualization = [getBreak(), ...getWrapping(ZeroAddress, amount)]
    //   return { ...call, fullVisualization }
    // },
    // [generalAdapterInterface.getFunction('unwrapNative')?.selector!]: (
    //   call: IrCall
    // ): IrCall | undefined => {
    //   const { amount } = generalAdapterInterface.parseTransaction(call)!.args
    //   const fullVisualization = [getBreak(), ...getUnwrapping(ZeroAddress, amount)]
    //   return { ...call, fullVisualization }
    // },
    // [generalAdapterInterface.getFunction('permit2TransferFrom')?.selector!]: (
    //     call: IrCall
    //   ): IrCall | undefined => {
    //     const { token, receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
    //     const fullVisualization = [
    //       getBreak(),
    //       getAction('Transfer'),
    //       getToken(token, amount),
    //       getLabel('To'),
    //       getAddressVisualization(receiver)
    //     ]
    //     return { ...call, fullVisualization }
    //   },
    [generalAdapterInterface.getFunction('morphoSupplyCollateral')?.selector!]: (
      call: IrCall
    ): IrCall | undefined => {
      const { marketParams, assets, onBehalf, data } =
        generalAdapterInterface.parseTransaction(call)!.args
      const collateral = marketParams[1]
      const collateralAmount = assets
      const fullVisualization = [
        getBreak(),
        getAction('Supply'),
        getToken(collateral, collateralAmount)
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, onBehalf) }
    },
    [generalAdapterInterface.getFunction('morphoBorrow')?.selector!]: (
      call: IrCall
    ): IrCall | undefined => {
      const { marketParams, assets, shares, minSharePriceE27, receiver } =
        generalAdapterInterface.parseTransaction(call)!.args
      const loanToken = marketParams[0]
      const loanAmount = assets
      const fullVisualization = [
        getBreak(),
        getAction('Take'),
        getToken(loanToken, loanAmount),
        getLabel('loan')
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
    },
    [generalAdapterInterface.getFunction('morphoRepay')?.selector!]: (
      call: IrCall
    ): IrCall | undefined => {
      const { marketParams, assets, shares, minSharePriceE27, onBehalf, data } =
        generalAdapterInterface.parseTransaction(call)!.args
      const loanToken = marketParams[0]
      const loanAmount = assets
      const fullVisualization = [getBreak(), getAction('Repay'), getToken(loanToken, loanAmount)]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, onBehalf) }
    },
    [generalAdapterInterface.getFunction('morphoWithdrawCollateral')?.selector!]: (
      call: IrCall
    ): IrCall | undefined => {
      const { marketParams, assets, receiver } =
        generalAdapterInterface.parseTransaction(call)!.args
      const collateralToken = marketParams[1]
      const amount = assets
      const fullVisualization = [
        getBreak(),
        getAction('Withdraw'),
        getToken(collateralToken, amount)
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
    },
    [generalAdapterInterface.getFunction('morphoFlashLoan')?.selector!]: (
      call: IrCall
    ): IrCall | undefined => {
      const { token, assets, data } = generalAdapterInterface.parseTransaction(call)!.args
      const fullVisualization = [
        getBreak(),
        getAction('Execute flash loan for'),
        getToken(token, assets)
      ]
      return { ...call, fullVisualization }
    },
    [generalAdapterInterface.getFunction('erc4626Mint')?.selector!]: (
      call: IrCall
    ): IrCall | undefined => {
      const { vault, assets, maxSharePriceE27, receiver } =
        generalAdapterInterface.parseTransaction(call)!.args
      const fullVisualization = [
        getBreak(),
        getAction('Supply to vault'),
        getAddressVisualization(vault)
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
    },
    [generalAdapterInterface.getFunction('erc4626Deposit')?.selector!]: (
      call: IrCall
    ): IrCall | undefined => {
      const { vault, assets, maxSharePriceE27, receiver } =
        generalAdapterInterface.parseTransaction(call)!.args
      const fullVisualization = [
        getBreak(),
        getAction('Mint from vault'),
        getAddressVisualization(vault)
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
    },
    [generalAdapterInterface.getFunction('erc4626Withdraw')?.selector!]: (
      call: IrCall
    ): IrCall | undefined => {
      const { vault, assets, maxSharePriceE27, receiver, owner } =
        generalAdapterInterface.parseTransaction(call)!.args
      const fullVisualization = [
        getBreak(),
        getAction('Withdraw from vault'),
        getAddressVisualization(vault)
      ]
      return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) }
    },
    [generalAdapterInterface.getFunction('erc4626Redeem')?.selector!]: (
      call: IrCall
    ): IrCall | undefined => {
      const { vault, assets, maxSharePriceE27, receiver, owner } =
        generalAdapterInterface.parseTransaction(call)!.args
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
  const matcher = {
    [iface.getFunction('multicall')?.selector!]: (call: IrCall): IrCall | undefined => {
      if (!call.to) return
      if (call.value) return
      const { bundle } = iface.parseTransaction(call)!.args
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
