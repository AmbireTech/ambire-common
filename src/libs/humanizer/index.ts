import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { parse, stringify } from '../richJson/richJson'
import { humanizeCallWithModules, humanizerCallModules } from './callModules'
import {
  Erc7730CallDescriptors,
  Erc7730ResolvedDescriptor,
  humanizeCallWithErc7730,
  humanizeMessageWithErc7730
} from './erc7730'
import { HumanizerMessageResult, IrCall, IrMessage } from './interfaces'
import {
  eip7702AuthorizationModule,
  getFirstHumanization,
  getTypedMessageHumanizer,
  plainTextMessageModules
} from './messageModules'
import { dedupeWarnings, getDeclaredDomain } from './utils'

/**
 * Humanizes a message with the message modules. A typed message uses only the
 * humanizer for its primary type, with no fallback to other typed humanizers.
 * A plain text message uses the first plain text module that matches. Other
 * kinds (e.g. sign in with Ethereum) are not humanized here.
 */
const humanizeMessageWithModules = (message: Message): HumanizerMessageResult | null => {
  // `message.content.kind` narrows only `content`, not `message`. A new object with
  // the narrowed `content` gives each humanizer its message type without a cast
  const { content } = message
  try {
    if (content.kind === 'typedMessage') {
      const humanizeTypedMessage = getTypedMessageHumanizer(content.primaryType)
      if (!humanizeTypedMessage) return null
      // Domain fields that `EIP712Domain` does not declare are not signed, so no typed
      // humanizer gets them (e.g. an undeclared `verifyingContract` must not be shown as the token)
      const contentWithDeclaredDomain = { ...content, domain: getDeclaredDomain(content) }
      return humanizeTypedMessage({ ...message, content: contentWithDeclaredDomain })
    }
    if (content.kind === 'message')
      return getFirstHumanization(plainTextMessageModules, { ...message, content })
    if (content.kind === 'authorization-7702')
      return eip7702AuthorizationModule({ ...message, content })
  } catch (error) {
    // A humanizer that throws shows no visualization, but the ERC-7730 descriptor can still be used
    console.error(error)
  }

  return null
}

type HumanizeAccountOpOptions = {
  erc7730Descriptors?: Erc7730CallDescriptors
  nativeAssetSymbol?: string
  /**
   * The name of the Privacy Pools account a call deposits into, when the wallet knows it. Shown
   * so deposits into several accounts in one batch can be told apart.
   */
  getPrivacyPoolsAccountName?: (call: Call) => string | undefined
}

type HumanizeMessageOptions = {
  erc7730Descriptor?: Erc7730ResolvedDescriptor
}

const humanizeAccountOp = (_accountOp: AccountOp, options?: HumanizeAccountOpOptions): IrCall[] => {
  const accountOp = parse(stringify(_accountOp))

  let currentCalls: IrCall[] = accountOp.calls.map((originalCall: IrCall) => {
    const privacyPoolsAccountName = options?.getPrivacyPoolsAccountName?.(originalCall)

    return humanizeCallWithModules(
      accountOp,
      privacyPoolsAccountName ? { ...originalCall, privacyPoolsAccountName } : originalCall
    )
  })

  if (options?.erc7730Descriptors) {
    currentCalls = currentCalls.map((call, index) => {
      const resolvedDescriptor = options.erc7730Descriptors?.[index]
      if (!resolvedDescriptor || call.preferredOverErc7730) return call

      try {
        const originalCall = accountOp.calls[index]
        if (!originalCall) return call

        const erc7730Call = humanizeCallWithErc7730(
          originalCall,
          accountOp.chainId,
          accountOp.accountAddr,
          resolvedDescriptor,
          options.nativeAssetSymbol
        )
        if (!erc7730Call) return call

        // The descriptor builds its result from the raw call, so it starts with no warnings. The
        // warnings the modules found are still about the same call, so keep them both.
        return {
          ...erc7730Call,
          warnings: dedupeWarnings([...(call.warnings || []), ...(erc7730Call.warnings || [])])
        }
      } catch (error) {
        console.error(error)
        return call
      }
    })
  }

  return currentCalls
}

const humanizeMessage = (_message: Message, options?: HumanizeMessageOptions): IrMessage => {
  const message = parse(stringify(_message))

  try {
    // Null means no module could humanize the message, so it has no visualization
    // and the UI shows the raw message
    const { fullVisualization, warnings, canHideDropdownArrow } =
      humanizeMessageWithModules(message) ?? {}

    if (options?.erc7730Descriptor) {
      const erc7730Message = humanizeMessageWithErc7730(message, options.erc7730Descriptor)
      if (erc7730Message) {
        // The descriptor builds its result from the raw message, so it starts with no warnings.
        // The warnings the message modules found are still about the same message, so keep both.
        return {
          ...erc7730Message,
          warnings: dedupeWarnings([...(warnings || []), ...(erc7730Message.warnings || [])])
        }
      }
    }

    return { ...message, fullVisualization, warnings, canHideDropdownArrow }
  } catch (error) {
    console.error(error)
    return message
  }
}

export * from './erc7730'
export { humanizeAccountOp, humanizeMessage, humanizerCallModules }
export type { HumanizeAccountOpOptions, HumanizeMessageOptions }
