import {
  decodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  parseAbi,
  toFunctionSelector,
  zeroAddress
} from 'viem'

import { allowedFallbackHandlers, allowedMulticallContracts } from '../../../../consts/safe'
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
  getText,
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
const setFallbackHandlerAbi = parseAbi(['function setFallbackHandler(address handler)'])
const setDomainVerifierAbi = parseAbi([
  'function setDomainVerifier(bytes32 domainSeparator, address newVerifier)'
])
const setupAbi = parseAbi([
  'function setup(address[] _owners,uint256 _threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)'
])
const execTransactionAbi = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)'
])
const MAX_SAFE_SETUP_HOOK_DEPTH = 4

export const shouldDisplaySafeDelegateCallWarning = (
  operation: bigint | number,
  to?: string
): boolean =>
  BigInt(operation) === 1n &&
  (!to || !isAddress(to) || !allowedMulticallContracts.includes(getAddress(to)))

export const getDelegateCallWarning = (
  operation: bigint | number,
  to?: string
): HumanizerWarning[] => {
  const warnings: HumanizerWarning[] = []

  if (shouldDisplaySafeDelegateCallWarning(operation, to))
    warnings.push(
      getWarning(
        'You are about to delegate permissions to a contract not whitelisted by Safe. Proceed with caution',
        'SAFE{WALLET}_DELEGATE_CALL',
        undefined,
        to && isAddress(to) ? getAddress(to) : undefined
      )
    )

  return warnings
}

export const getSafeHumanization = (
  safeAddr?: string,
  to?: string,
  value?: string | number | bigint,
  data?: string,
  setupHookDepth = 0
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

  if (selector === toFunctionSelector(setupAbi[0])) {
    const { args } = decodeFunctionData({ abi: setupAbi, data })
    const [
      owners,
      threshold,
      setupTo,
      setupData,
      fallbackHandler,
      paymentToken,
      payment,
      paymentReceiver
    ] = args
    fullVisualization.push(getAction('Account setup'))

    if (owners.length) {
      fullVisualization.push(
        getLabel(owners.length === 1 ? 'Owner' : 'Owners'),
        ...owners.map((owner) => getAddressVisualization(owner))
      )
    }

    fullVisualization.push(getLabel('Threshold'), getText(threshold.toString()))

    if (fallbackHandler.toLowerCase() !== zeroAddress) {
      fullVisualization.push(getLabel('Fallback handler'), getAddressVisualization(fallbackHandler))
    }

    if (payment) {
      fullVisualization.push(getLabel('Payment'), getToken(paymentToken, payment))
    }

    if (paymentReceiver.toLowerCase() !== zeroAddress) {
      fullVisualization.push(getLabel('Payment receiver'), getAddressVisualization(paymentReceiver))
    }

    if (
      setupHookDepth < MAX_SAFE_SETUP_HOOK_DEPTH &&
      setupTo.toLowerCase() !== zeroAddress &&
      setupData !== '0x'
    ) {
      const setupCallHumanization = getSafeHumanization(
        safeAddr,
        setupTo,
        0n,
        setupData,
        setupHookDepth + 1
      )

      if (setupCallHumanization?.visuals?.length) {
        fullVisualization.push(getBreak(), getLabel('Setup transaction'))
        fullVisualization.push(...setupCallHumanization.visuals)
      }
      if (setupCallHumanization?.warnings) warnings.push(...setupCallHumanization.warnings)
    }

    warnings.push(getWarning(`Safe setup configuration detected`, 'SAFE{WALLET}_CONFIG_CHANGE'))

    return {
      visuals: fullVisualization,
      warnings
    }
  }

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

  if (selector === toFunctionSelector(setFallbackHandlerAbi[0])) {
    const { args } = decodeFunctionData({ abi: setFallbackHandlerAbi, data })
    const [handler] = args
    fullVisualization.push(
      ...[getAction('Extend your account functionality with'), getAddressVisualization(handler)]
    )

    // The fallback handler controls how the Safe responds to calls it doesn't natively
    // implement, most importantly EIP-1271 `isValidSignature` checks, so swapping in
    // anything other than a known Safe default deserves explicit user attention
    if (
      handler.toLowerCase() !== zeroAddress &&
      !allowedFallbackHandlers.includes(getAddress(handler))
    ) {
      warnings.push(
        getWarning(
          'This adds new functionality to your account from a contract that is not a Safe default. Only proceed if you trust its source',
          'SAFE{WALLET}_FALLBACK_HANDLER',
          undefined,
          getAddress(handler)
        )
      )
    }

    return {
      visuals: fullVisualization,
      warnings
    }
  }

  if (selector === toFunctionSelector(setDomainVerifierAbi[0])) {
    const { args } = decodeFunctionData({ abi: setDomainVerifierAbi, data })
    const [, newVerifier] = args
    fullVisualization.push(
      ...[
        getAction('Authorize custom access rights to your account for'),
        getAddressVisualization(newVerifier)
      ]
    )
    // Grants the verifier contract standing authority to approve EIP-712 signed messages/orders
    // under this domain on behalf of the Safe, without further owner confirmation per action
    warnings.push(
      getWarning(
        'This lets the contract above approve certain actions on behalf of your account automatically, without asking you each time. Only proceed if you trust it',
        'SAFE{WALLET}_DOMAIN_VERIFIER',
        undefined,
        getAddress(newVerifier)
      )
    )
    return {
      visuals: fullVisualization,
      warnings
    }
  }

  return undefined
}

const SafeModule: HumanizerCallModule = (accOp: AccountOp, call: IrCall): IrCall => {
  const matcher = {
    [toFunctionSelector(execTransactionAbi[0])]: (matchedCall: HexIrCall): IrCall | undefined => {
      if (!matchedCall.to) return
      if (matchedCall.value) return
      let args: unknown[]

      try {
        args = [...decodeFunctionData({ abi: execTransactionAbi, data: matchedCall.data }).args]
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

      const safeSpecificHumanization = getSafeHumanization(accOp.accountAddr, to, bigintValue, data)
      const fullVisualization = [
        getAction('Execute a Safe{WALLET} transaction'),
        getLabel('from'),
        getAddressVisualization(matchedCall.to),
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

      return { ...matchedCall, fullVisualization, warnings }
    }
  }

  let newCall = call
  const safeSpecificHumanization = getSafeHumanization(
    accOp.accountAddr,
    call.to,
    call.value,
    call.data
  )
  if (safeSpecificHumanization) {
    newCall = {
      ...call,
      fullVisualization: safeSpecificHumanization.visuals,
      warnings: safeSpecificHumanization.warnings
    }
  } else if (isHexCall(call)) {
    const match = matcher[call.data.slice(0, 10)]
    if (!call.fullVisualization && match) {
      const matchedCall = match(call)
      if (matchedCall) newCall = matchedCall
    }
  }

  return newCall
}

export default SafeModule
