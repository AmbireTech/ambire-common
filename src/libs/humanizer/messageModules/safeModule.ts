import { Interface, isAddress } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { SafeV2 } from '../const/abis/Safe'
import {
  HumanizerTypedMessageModule,
  HumanizerVisualization,
  HumanizerWarning
} from '../interfaces'
import { genericErc20Humanizer } from '../modules/Tokens'
import { getAction, getAddressVisualization, getBreak, getLabel, getWarning } from '../utils'

const getOwnerChangeHumanization = (
  data?: string
): { visuals?: HumanizerVisualization[]; warnings?: HumanizerWarning[] } | undefined => {
  if (!data) return

  const selector = data.substring(0, 10)
  const safeInterface = new Interface(SafeV2)
  const fullVisualization: HumanizerVisualization[] = []
  const warnings: HumanizerWarning[] = []

  const addOwnerWithThreshold = safeInterface.getFunction('addOwnerWithThreshold')?.selector
  if (selector === addOwnerWithThreshold) {
    const decoded = safeInterface.decodeFunctionData('addOwnerWithThreshold', data)
    const newOwner = decoded[0]
    const newThreshold = decoded[1]
    fullVisualization.push(
      ...[
        getBreak(),
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

  const changeThreshold = safeInterface.getFunction('changeThreshold')?.selector
  if (selector === changeThreshold) {
    const decoded = safeInterface.decodeFunctionData('changeThreshold', data)
    const newThreshold = decoded[0]
    fullVisualization.push(...[getBreak(), getAction('Set threshold to'), getLabel(newThreshold)])
    warnings.push(
      getWarning(`Threshold configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE')
    )
    return {
      visuals: fullVisualization,
      warnings
    }
  }

  const removeOwner = safeInterface.getFunction('removeOwner')?.selector
  if (selector === removeOwner) {
    const decoded = safeInterface.decodeFunctionData('removeOwner', data)
    const removedOwner = decoded[1]
    const newThreshold = decoded[2]
    fullVisualization.push(
      ...[
        getBreak(),
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

  const swapOwner = safeInterface.getFunction('swapOwner')?.selector
  if (selector === swapOwner) {
    const decoded = safeInterface.decodeFunctionData('swapOwner', data)
    const removedOwner = decoded[1]
    const newOwner = decoded[2]
    fullVisualization.push(
      ...[
        getBreak(),
        getAction('Remove owner'),
        getAddressVisualization(removedOwner),
        getBreak(),
        getAction('Set new owner'),
        getLabel(newOwner)
      ]
    )
    warnings.push(getWarning(`Owner configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE'))
    return {
      visuals: fullVisualization,
      warnings
    }
  }

  return undefined
}

export const safeMessageModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind === 'message' || typeof message.content.message === 'string')
    return { fullVisualization: [] }
  if (message.content.primaryType !== 'SafeTx') return { fullVisualization: [] }
  const { to, value, data, operation } = message.content.message
  const { accountAddr } = message
  const { verifyingContract } = message.content.domain
  const humanizedCalls = genericErc20Humanizer({ accountAddr }, [{ to, value, data }])
  const ownerHumanization = getOwnerChangeHumanization(data)
  const fullVisualization: HumanizerVisualization[] = []
  if (!isAddress(verifyingContract)) return {}
  fullVisualization.push(
    ...[
      getAction('Safe{WALLET} transaction'),
      getLabel('from'),
      getAddressVisualization(verifyingContract)
    ],
    ...(ownerHumanization && ownerHumanization.visuals ? ownerHumanization.visuals : [])
  )
  if (humanizedCalls[0]?.fullVisualization) {
    fullVisualization.push(...humanizedCalls[0].fullVisualization)
  }
  if (operation === 1) {
    return {
      fullVisualization,
      warnings: [
        getWarning('Delegate call from Safe{WALLET} account', 'SAFE{WALLET}_DELEGATE_CALL')
      ]
    }
  }

  return {
    fullVisualization,
    warnings: ownerHumanization && ownerHumanization.warnings ? ownerHumanization.warnings : []
  }
}
