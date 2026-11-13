import { HumanizerMessageResult, HumanizerTypedMessageFunction } from '../interfaces'
import { humanizeCowSwapOrder, humanizeCowSwapOrderCancellations } from './cowSwapModule'
import { eip7702AuthorizationModule } from './eip7702AuthorizationModule'
import { humanizeEnsUpload } from './ensModule'
import { humanizeEntryPointAuthorization } from './entryPointModule'
import { humanizeErc20Permit } from './erc20Module'
import { ERC721_PERMIT_FIELD_NAMES, humanizeErc721Permit } from './erc721Module'
import { fallbackShortPlaintext } from './fallbackShortPlaintext'
import { legendsMessageModule } from './legendsModule'
import { humanizeSeaportOrder, openseaLoginMessageModule } from './openseaModule'
import {
  humanizePermit2Batch,
  humanizePermit2Single,
  humanizePermit2Transfer,
  humanizePermit2WitnessTransfer
} from './permit2Module'
import { humanizeSafeTx } from './safeModule'
import { humanizeSnapshotVote } from './snapshotModule'
import { zealyMessageModule } from './zealyModule'
import { isTypeDeclaringFields } from '../utils'

/**
 * Runs the plain text modules in order and returns the first result with a visualization.
 * A module that throws is logged and skipped, so it does not block the others.
 */
export const getFirstHumanization = <TMessage>(
  humanizers: ((message: TMessage) => HumanizerMessageResult)[],
  message: TMessage
): HumanizerMessageResult => {
  for (const humanize of humanizers) {
    try {
      const humanization = humanize(message)
      if (humanization.fullVisualization?.length) return humanization
    } catch (error) {
      console.error(error)
    }
  }

  return {}
}

/**
 * ERC-20 (EIP-2612 and DAI-style) and ERC-721 permits share the `Permit` primary
 * type. The humanizer is chosen from the fields declared in `types.Permit` (signed),
 * not by trying one and falling back to the other.
 */
const humanizePermit: HumanizerTypedMessageFunction = (message) =>
  isTypeDeclaringFields(message.content.types, 'Permit', ERC721_PERMIT_FIELD_NAMES)
    ? humanizeErc721Permit(message)
    : humanizeErc20Permit(message)

/**
 * Typed message humanizers keyed by the EIP-712 primary type they expect. Only
 * the primary type and the types it references are signed, so the humanizer is
 * chosen from it, never from other entries in `types` or keys in `message`.
 */
export const typedMessageHumanizers: Readonly<Record<string, HumanizerTypedMessageFunction>> = {
  Permit: humanizePermit,
  PermitSingle: humanizePermit2Single,
  PermitBatch: humanizePermit2Batch,
  PermitTransferFrom: humanizePermit2Transfer,
  PermitWitnessTransferFrom: humanizePermit2WitnessTransfer,
  PermitBatchWitnessTransferFrom: humanizePermit2WitnessTransfer,
  Order: humanizeCowSwapOrder,
  OrderCancellations: humanizeCowSwapOrderCancellations,
  OrderComponents: humanizeSeaportOrder,
  SafeTx: humanizeSafeTx,
  Vote: humanizeSnapshotVote,
  Upload: humanizeEnsUpload,
  AmbireOperation: humanizeEntryPointAuthorization
}

/**
 * Returns the humanizer for a primary type, or undefined when there is none.
 * Only own keys are read, so a primary type such as `constructor` or `__proto__`
 * cannot return a function from `Object.prototype`.
 */
export const getTypedMessageHumanizer = (
  primaryType: string
): HumanizerTypedMessageFunction | undefined =>
  Object.hasOwn(typedMessageHumanizers, primaryType)
    ? typedMessageHumanizers[primaryType]
    : undefined

/**
 * Plain text message modules, from least generic to most generic.
 * The visualization and warnings come from the first module that matches.
 */
export const plainTextMessageModules = [
  legendsMessageModule,
  openseaLoginMessageModule,
  zealyMessageModule,
  fallbackShortPlaintext
]

export { eip7702AuthorizationModule }
