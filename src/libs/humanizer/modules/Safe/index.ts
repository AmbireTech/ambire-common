import {
  decodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  parseAbi,
  toFunctionSelector,
  zeroAddress
} from 'viem'

import { allowedMulticallContracts } from '../../../../consts/safe'
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
  HexIrCall,
  isHexCall
} from '../../utils'

const addOwnerWithThresholdAbi = parseAbi([
  'function addOwnerWithThreshold(address owner, uint256 _threshold)'
])
const changeThresholdAbi = parseAbi(['function changeThreshold(uint256 _threshold)'])
const removeOwnerAbi = parseAbi([
  'function removeOwner(address prevOwner, address owner, uint256 _threshold)'
])
const swapOwnerAbi = parseAbi([
  'function swapOwner(address prevOwner, address oldOwner, address newOwner)'
])
const enableModuleAbi = parseAbi(['function enableModule(address module)'])
const disableModuleAbi = parseAbi(['function disableModule(address prevModule, address module)'])
const setGuardAbi = parseAbi(['function setGuard(address guard)'])
const execTransactionAbi = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)'
])

export const getDelegateCallWarning = (
  operation: bigint | number,
  to?: string
): HumanizerWarning[] => {
  const warnings: HumanizerWarning[] = []

  if (
    BigInt(operation) === 1n &&
    (!to || !isAddress(to) || !allowedMulticallContracts.includes(getAddress(to)))
  )
    warnings.push(
      getWarning(
        'You are about to delegate permissions to a contract not whitelisted by Safe. Proceed with caution',
        'SAFE{WALLET}_DELEGATE_CALL'
      )
    )

  return warnings
}

export const getSafeHumanization = (
  safeAddr?: string,
  to?: string,
  value?: string | number | bigint,
  data?: string
): { visuals?: HumanizerVisualization[]; warnings?: HumanizerWarning[] } | undefined => {
  if (!data || !isHex(data)) return

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

  if (selector === toFunctionSelector(addOwnerWithThresholdAbi[0])) {
    const { args } = decodeFunctionData({
      abi: addOwnerWithThresholdAbi,
      data
    })
    const [newOwner, newThreshold] = args
    fullVisualization.push(
      ...[
        getAction('Add owner'),
        getAddressVisualization(newOwner),
        getAction('and set threshold to'),
        getLabel(newThreshold.toString())
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

  if (selector === toFunctionSelector(changeThresholdAbi[0])) {
    const { args } = decodeFunctionData({ abi: changeThresholdAbi, data })
    const [newThreshold] = args
    fullVisualization.push(...[getAction('Set threshold to'), getLabel(newThreshold)])
    warnings.push(
      getWarning(`Threshold configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE')
    )
    return {
      visuals: fullVisualization,
      warnings
    }
  }

  if (selector === toFunctionSelector(removeOwnerAbi[0])) {
    const { args } = decodeFunctionData({ abi: removeOwnerAbi, data })
    const [, removedOwner, newThreshold] = args
    fullVisualization.push(
      ...[
        getAction('Remove owner'),
        getAddressVisualization(removedOwner),
        getAction('and set threshold to'),
        getLabel(newThreshold.toString())
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

  if (selector === toFunctionSelector(swapOwnerAbi[0])) {
    const { args } = decodeFunctionData({ abi: swapOwnerAbi, data })
    const [, removedOwner, newOwner] = args
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

  if (selector === toFunctionSelector(enableModuleAbi[0])) {
    const { args } = decodeFunctionData({ abi: enableModuleAbi, data })
    const [module] = args
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

  if (selector === toFunctionSelector(disableModuleAbi[0])) {
    const { args } = decodeFunctionData({ abi: disableModuleAbi, data })
    const [, module] = args
    fullVisualization.push(...[getAction('Disable module:'), getAddressVisualization(module)])
    return {
      visuals: fullVisualization
    }
  }

  if (selector === toFunctionSelector(setGuardAbi[0])) {
    const { args } = decodeFunctionData({ abi: setGuardAbi, data })
    const [guard] = args
    fullVisualization.push(...[getAction('Set guard:'), getAddressVisualization(guard)])
    return {
      visuals: fullVisualization
    }
  }

  return undefined
}

const SafeModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]): IrCall[] => {
  const matcher = {
    [toFunctionSelector(execTransactionAbi[0])]: (call: HexIrCall): IrCall | undefined => {
      if (!call.to) return
      if (call.value) return
      let args: unknown[]

      try {
        args = [...decodeFunctionData({ abi: execTransactionAbi, data: call.data }).args]
      } catch {
        return
      }

      const [to, value, data, operation] = args
      if (typeof to !== 'string') return
      if (typeof data !== 'string') return
      if (typeof value !== 'bigint' && typeof value !== 'number' && typeof value !== 'string')
        return
      if (
        typeof operation !== 'bigint' &&
        typeof operation !== 'number' &&
        typeof operation !== 'string'
      )
        return
      const bigintValue = BigInt(value)
      const bigintOperation = BigInt(operation)

      const safeSpecificHumanization = getSafeHumanization(
        accOp.accountAddr,
        to,
        bigintValue,
        data
      )
      const fullVisualization = [
        getAction('Execute a Safe{WALLET} transaction'),
        getLabel('from'),
        getAddressVisualization(call.to),
        getLabel('to'),
        getAddressVisualization(to)
      ]

      if (bigintValue)
        fullVisualization.push(
          ...[getLabel('and'), getAction('Send'), getToken(zeroAddress, bigintValue)]
        )

      const warnings: HumanizerWarning[] = []

      if (safeSpecificHumanization) {
        if (safeSpecificHumanization.visuals)
          fullVisualization.push(getBreak(), ...safeSpecificHumanization.visuals)
        if (safeSpecificHumanization.warnings) warnings.push(...safeSpecificHumanization.warnings)
      }

      const delegateCallWarnings = getDelegateCallWarning(bigintOperation, to)
      if (delegateCallWarnings.length) warnings.push(...delegateCallWarnings)

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

    if (!isHexCall(call)) return call
    const match = matcher[call.data.slice(0, 10)]
    if (call.fullVisualization || !match) return call
    const newCall = match(call)
    if (!newCall) return call
    return newCall
  })

  if (accOp.safeTx) {
    const warningInSafeTx = getDelegateCallWarning(BigInt(accOp.safeTx.operation), accOp.safeTx.to)
    if (warningInSafeTx.length && newCalls.length) {
      const firstCall = newCalls[0]!
      const firstCallWarnings: HumanizerWarning[] = firstCall.warnings || []
      warningInSafeTx.push(...firstCallWarnings)
      firstCall.warnings = warningInSafeTx
    }
  }

  return newCalls
}

export default SafeModule
