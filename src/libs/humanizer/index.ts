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
}

type HumanizeMessageOptions = {
  erc7730Descriptor?: Erc7730ResolvedDescriptor
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

        return (
          humanizeCallWithErc7730(
            originalCall,
            accountOp.chainId,
            accountOp.accountAddr,
            resolvedDescriptor,
            0,
            options.nativeAssetSymbol
          ) || call
        )
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
