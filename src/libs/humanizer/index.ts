import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { parse, stringify } from '../richJson/richJson'
import { humanizerCallModules } from './callModules'
import {
  Erc7730CallDescriptors,
  Erc7730ResolvedDescriptor,
  humanizeCallWithErc7730,
  humanizeMessageWithErc7730
} from './erc7730'
import { HumanizerMeta, IrCall, IrMessage } from './interfaces'
import {
  cowSwapModule,
  eip7702AuthorizationModule,
  ensMessageModule,
  entryPointModule,
  erc20Module,
  erc721Module,
  legendsMessageModule,
  openseaMessageModule,
  permit2Module,
  safeMessageModule,
  snapshotModule,
  zealyMessageModule
} from './messageModules'
import { fallbackShortPlaintext } from './messageModules/fallbackShortPlaintext'
import { dedupeWarnings, UNLIMITED_APPROVAL_WARNING_CODE } from './utils'

// from least generic to most generic
// the final visualization and warnings are from the first triggered module
const humanizerTMModules = [
  safeMessageModule,
  erc20Module,
  erc721Module,
  permit2Module,
  cowSwapModule,
  entryPointModule,
  legendsMessageModule,
  ensMessageModule,
  openseaMessageModule,
  zealyMessageModule,
  safeMessageModule,
  eip7702AuthorizationModule,
  snapshotModule,
  fallbackShortPlaintext
]

type HumanizeAccountOpOptions = {
  erc7730Descriptors?: Erc7730CallDescriptors
  nativeAssetSymbol?: string
  /**
   * Decides whether the app that requested a call is one we already trust. Unlimited approval
   * warnings are dropped for calls from a trusted app, because the modules that detect them
   * cannot read the app catalog themselves. A call with no app url is never trusted.
   */
  isDappTrusted?: (dappUrl?: string) => boolean
}

type HumanizeMessageOptions = {
  erc7730Descriptor?: Erc7730ResolvedDescriptor
}

/**
 * Humanizer modules cannot read the app catalog, so they report every unlimited approval. This
 * removes that warning again when the app is one we already trust. A call with no app url keeps
 * the warning: an unknown origin is not a trusted one.
 */
const dropUnlimitedApprovalWarningIfTrusted = (
  call: IrCall,
  dappUrl: string | undefined,
  isDappTrusted: (dappUrl?: string) => boolean
): IrCall => {
  if (!call.warnings?.length || !dappUrl || !isDappTrusted(dappUrl)) return call

  const warnings = call.warnings.filter(
    (warning) => warning.code !== UNLIMITED_APPROVAL_WARNING_CODE
  )
  if (warnings.length === call.warnings.length) return call

  return { ...call, warnings }
}

const humanizeAccountOp = (_accountOp: AccountOp, options?: HumanizeAccountOpOptions): IrCall[] => {
  const accountOp = parse(stringify(_accountOp))

  let currentCalls: IrCall[] = accountOp.calls.map((originalCall: IrCall) => {
    let currentCall: IrCall = originalCall
    humanizerCallModules.forEach((hm) => {
      try {
        currentCall = hm(accountOp, currentCall, humanizerInfo as HumanizerMeta)
      } catch (error) {
        console.error(error)
        // No action is needed here; we only update `currentCall` if the module successfully resolves it.
      }
    })
    return currentCall
  })

  if (options?.erc7730Descriptors) {
    currentCalls = currentCalls.map((call, index) => {
      const resolvedDescriptor = options.erc7730Descriptors?.[index]
      if (!resolvedDescriptor) return call

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

  const { isDappTrusted } = options || {}
  if (isDappTrusted) {
    currentCalls = currentCalls.map((call, index) =>
      dropUnlimitedApprovalWarningIfTrusted(call, accountOp.calls[index]?.dapp?.url, isDappTrusted)
    )
  }

  return currentCalls
}

const humanizeMessage = (_message: Message, options?: HumanizeMessageOptions): IrMessage => {
  const message = parse(stringify(_message))

  try {
    if (options?.erc7730Descriptor) {
      const erc7730Message = humanizeMessageWithErc7730(message, options.erc7730Descriptor)
      if (erc7730Message) return erc7730Message
    }

    // runs all modules and takes the first non empty array
    const { fullVisualization, warnings, canHideDropdownArrow } =
      humanizerTMModules
        .map((m) => {
          try {
            return m(message)
          } catch (error) {
            console.error(error)
            return {}
          }
        })
        .filter((p) => p.fullVisualization?.length)[0] || {}

    return { ...message, fullVisualization, warnings, canHideDropdownArrow }
  } catch (error) {
    console.error(error)
    return message
  }
}

export * from './erc7730'
export { humanizeAccountOp, humanizeMessage, humanizerCallModules }
export type { HumanizeAccountOpOptions, HumanizeMessageOptions }
