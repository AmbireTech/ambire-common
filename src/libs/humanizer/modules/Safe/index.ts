/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { SafeV2 } from '../../const/abis/Safe'
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

const iface = new Interface(SafeV2)

export const getSafeHumanization = (
  safeAddr?: string,
  to?: string,
  value?: string | number | bigint,
  data?: string
): { visuals?: HumanizerVisualization[]; warnings?: HumanizerWarning[] } | undefined => {
  if (!data) return

  const fullVisualization: HumanizerVisualization[] = []
  const warnings: HumanizerWarning[] = []

  if (
    to &&
    safeAddr &&
    to.toLowerCase() === safeAddr.toLowerCase() &&
    value?.toString() === '0' &&
    data === '0x'
  ) {
    fullVisualization.push(...[getAction('Reject currently queued transaction')])
    return {
      visuals: fullVisualization
    }
  }

  const selector = data.substring(0, 10)
  const addOwnerWithThreshold = iface.getFunction('addOwnerWithThreshold')?.selector
  if (selector === addOwnerWithThreshold) {
    const decoded = iface.decodeFunctionData('addOwnerWithThreshold', data)
    const newOwner = decoded[0]
    const newThreshold = decoded[1]
    fullVisualization.push(
      ...[
        getAction('Add owner'),
        getAddressVisualization(newOwner),
        getAction('and set threshold to'),
        getLabel(newThreshold)
      ]
    )
    warnings.push(
      getWarning(`Owner & threshold configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE')
    )
    return {
      visuals: fullVisualization,
      warnings
    }
  }

  const changeThreshold = iface.getFunction('changeThreshold')?.selector
  if (selector === changeThreshold) {
    const decoded = iface.decodeFunctionData('changeThreshold', data)
    const newThreshold = decoded[0]
    fullVisualization.push(...[getAction('Set threshold to'), getLabel(newThreshold)])
    warnings.push(
      getWarning(`Threshold configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE')
    )
    return {
      visuals: fullVisualization,
      warnings
    }
  }

  const removeOwner = iface.getFunction('removeOwner')?.selector
  if (selector === removeOwner) {
    const decoded = iface.decodeFunctionData('removeOwner', data)
    const removedOwner = decoded[1]
    const newThreshold = decoded[2]
    fullVisualization.push(
      ...[
        getAction('Remove owner'),
        getAddressVisualization(removedOwner),
        getAction('and set threshold to'),
        getLabel(newThreshold)
      ]
    )
    warnings.push(
      getWarning(`Owner & threshold configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE')
    )
    return {
      visuals: fullVisualization,
      warnings
    }
  }

  const swapOwner = iface.getFunction('swapOwner')?.selector
  if (selector === swapOwner) {
    const decoded = iface.decodeFunctionData('swapOwner', data)
    const removedOwner = decoded[1]
    const newOwner = decoded[2]
    fullVisualization.push(
      ...[
        getAction('Remove owner'),
        getAddressVisualization(removedOwner),
        getBreak(),
        getAction('Set new owner'),
        getAddressVisualization(newOwner)
      ]
    )
    warnings.push(getWarning(`Owner configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE'))
    return {
      visuals: fullVisualization,
      warnings
    }
  }

  const enableModule = iface.getFunction('enableModule')?.selector
  if (selector === enableModule) {
    const decoded = iface.decodeFunctionData('enableModule', data)
    const module = decoded[0]
    fullVisualization.push(...[getAction('Enable module:'), getAddressVisualization(module)])
    warnings.push(
      getWarning(
        `Modules can execute transactions if conditions are met`,
        'SAFE{WALLET}_CONFIG_CHANGE'
      )
    )
    return {
      visuals: fullVisualization,
      warnings
    }
  }

  const disableModule = iface.getFunction('disableModule')?.selector
  if (selector === disableModule) {
    const decoded = iface.decodeFunctionData('disableModule', data)
    const module = decoded[1]
    fullVisualization.push(...[getAction('Disable module:'), getAddressVisualization(module)])
    return {
      visuals: fullVisualization
    }
  }

  const setGuard = iface.getFunction('setGuard')?.selector
  if (selector === setGuard) {
    const decoded = iface.decodeFunctionData('setGuard', data)
    const guard = decoded[0]
    fullVisualization.push(...[getAction('Set guard:'), getAddressVisualization(guard)])
    return {
      visuals: fullVisualization
    }
  }

  return undefined
}

const SafeModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]): IrCall[] => {
  const matcher = {
    [iface.getFunction(
      'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)'
    )?.selector!]: (call: IrCall): IrCall | undefined => {
      if (!call.to) return
      if (call.value) return
      const {
        to,
        value,
        data,
        operation,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        signatures
      } = iface.parseTransaction(call)!.args

      const safeSpecificHumanization = getSafeHumanization(accOp.accountAddr, to, value, data)
      const fullVisualization = [
        getAction('Execute a Safe{WALLET} transaction'),
        getLabel('from'),
        getAddressVisualization(call.to),
        getLabel('to'),
        getAddressVisualization(to)
      ]

      if (value)
        fullVisualization.push(
          ...[getLabel('and'), getAction('Send'), getToken(ZeroAddress, value)]
        )

      const warnings: HumanizerWarning[] = []

      if (safeSpecificHumanization) {
        if (safeSpecificHumanization.visuals)
          fullVisualization.push(getBreak(), ...safeSpecificHumanization.visuals)
        if (safeSpecificHumanization.warnings) warnings.push(...safeSpecificHumanization.warnings)
      }

      if (operation === 1n)
        warnings.push(
          getWarning('Delegate call from Safe{WALLET} account', 'SAFE{WALLET}_DELEGATE_CALL')
        )

      return { ...call, fullVisualization, warnings }
    }
  }
  const newCalls = calls.map((call) => {
    const safeSpecificHumanization = getSafeHumanization(
      accOp.accountAddr,
      call.to,
      call.value,
      call.data
    )
    if (safeSpecificHumanization) {
      return {
        ...call,
        fullVisualization: safeSpecificHumanization.visuals,
        warnings: safeSpecificHumanization.warnings
      }
    }

    const match = matcher[call.data.slice(0, 10)]
    if (call.fullVisualization || !match) return call
    const newCall = match(call)
    if (!newCall) return call
    return newCall
  })

  return newCalls
}

export default SafeModule
