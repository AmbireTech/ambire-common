import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { parse, stringify } from '../richJson/richJson'
import { humanizeCallWithModules, humanizerCallModules } from './callModules'
import {
  Erc7730CallDescriptors,
  Erc7730ResolvedDescriptor,
  humanizeCallWithErc7730,
  humanizeMessageWithErc7730
} from './erc7730'
import { IrCall, IrMessage } from './interfaces'
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
import { dedupeWarnings, getNativeValueWarning, NATIVE_VALUE_WARNING_CODE } from './utils'

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

const REVOKE_APPROVAL_INTENT = 'Revoke approval'

/**
 * A descriptor names its action after the function it describes, so it calls an approval that
 * takes the permission back "Approve". When a module has seen that the call is a revoke, the
 * descriptor's result says so too.
 */
const keepRevokeApprovalIntent = (moduleCall: IrCall, erc7730Call: IrCall): IrCall => {
  const moduleAction = moduleCall.fullVisualization?.intent[0]
  const erc7730Visualization = erc7730Call.fullVisualization
  const erc7730Action = erc7730Visualization?.intent[0]
  if (!erc7730Visualization || erc7730Action?.type !== 'action') return erc7730Call
  if (moduleAction?.type !== 'action' || moduleAction.content !== REVOKE_APPROVAL_INTENT) {
    return erc7730Call
  }
  if (erc7730Action.content !== 'Approve') return erc7730Call

  return {
    ...erc7730Call,
    fullVisualization: {
      ...erc7730Visualization,
      intent: [moduleAction, ...erc7730Visualization.intent.slice(1)]
    }
  }
}

/**
 * A module does not know the name of the native coin, so the warning it adds when a call sends the
 * coin names it in a general way. This words it with the name, as a descriptor's warning does.
 */
const nameNativeAssetInWarnings = (call: IrCall, nativeAssetSymbol?: string): IrCall => {
  if (!nativeAssetSymbol) return call

  return {
    ...call,
    warnings: call.warnings?.map((warning) =>
      warning.code === NATIVE_VALUE_WARNING_CODE
        ? getNativeValueWarning(nativeAssetSymbol)
        : warning
    )
  }
}

type HumanizeAccountOpOptions = {
  erc7730Descriptors?: Erc7730CallDescriptors
  nativeAssetSymbol?: string
}

type HumanizeMessageOptions = {
  erc7730Descriptor?: Erc7730ResolvedDescriptor
}

const humanizeAccountOp = (_accountOp: AccountOp, options?: HumanizeAccountOpOptions): IrCall[] => {
  const accountOp = parse(stringify(_accountOp))

  let currentCalls: IrCall[] = accountOp.calls.map((originalCall: IrCall) =>
    nameNativeAssetInWarnings(
      humanizeCallWithModules(accountOp, originalCall),
      options?.nativeAssetSymbol
    )
  )

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
        // The warning about the native coin belongs to the visualization that showed the coin. The
        // descriptor's visualization replaced it, and the descriptor decides if the coin is shown.
        const moduleWarnings = (call.warnings || []).filter(
          (warning) => warning.code !== NATIVE_VALUE_WARNING_CODE
        )

        return {
          ...keepRevokeApprovalIntent(call, erc7730Call),
          warnings: dedupeWarnings([...moduleWarnings, ...(erc7730Call.warnings || [])])
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
    // runs all modules and takes the first non empty array
    const { fullVisualization, richVisualization, warnings, canHideDropdownArrow } =
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

    if (options?.erc7730Descriptor) {
      const erc7730Message = humanizeMessageWithErc7730(message, options.erc7730Descriptor)
      if (erc7730Message) {
        // The descriptor builds its result from the raw message, so it starts with no warnings.
        // The warnings humanizerTMModules found are still about the same message, so keep both.
        return {
          ...erc7730Message,
          warnings: dedupeWarnings([...(warnings || []), ...(erc7730Message.warnings || [])])
        }
      }
    }

    return { ...message, fullVisualization, richVisualization, warnings, canHideDropdownArrow }
  } catch (error) {
    console.error(error)
    return message
  }
}

export * from './erc7730'
export { humanizeAccountOp, humanizeMessage, humanizerCallModules }
export type { HumanizeAccountOpOptions, HumanizeMessageOptions }
