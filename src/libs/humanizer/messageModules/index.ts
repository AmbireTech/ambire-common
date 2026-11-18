import { HumanizerMessageResult, HumanizerTypedMessageFunction } from '../interfaces'
import { humanizeCowSwapOrder, humanizeCowSwapOrderCancellations } from './cowSwapModule'
import { eip7702AuthorizationModule } from './eip7702AuthorizationModule'
import { humanizeEnsUpload } from './ensModule'
import { humanizeEntryPointAuthorization } from './entryPointModule'
import { fallbackShortPlaintext } from './fallbackShortPlaintext'
import { hashMessageModule } from './hashMessageModule'
import { legendsMessageModule } from './legendsModule'
import { humanizeSeaportOrder, openseaLoginMessageModule } from './openseaModule'
import { humanizePermit } from './permitModule'
import {
  humanizePermit2Batch,
  humanizePermit2BatchWitnessTransfer,
  humanizePermit2Single,
  humanizePermit2Transfer,
  humanizePermit2WitnessTransfer
} from './permit2Module'
import { humanizeSafeTx } from './safeModule'
import { humanizeSnapshotVote } from './snapshotModule'
import { zealyMessageModule } from './zealyModule'

/**
 * Runs the plain text modules in order and returns the first result that is not null.
 * A module that throws is logged and skipped, so it does not block the others.
 */
export const getFirstHumanization = <TMessage>(
  humanizers: ((message: TMessage) => HumanizerMessageResult | null)[],
  message: TMessage
): HumanizerMessageResult | null => {
  for (const humanize of humanizers) {
    try {
      const humanization = humanize(message)
      if (humanization) return humanization
    } catch (error) {
      console.error(error)
    }
  }

  return null
}

/**
 * Typed message humanizers keyed by the EIP-712 primary type they expect. Only
 * the primary type and the types it references are signed, so the humanizer is
 * chosen from it, never from other entries in `types` or keys in `message`.
 */
const typedMessageHumanizers: Readonly<Record<string, HumanizerTypedMessageFunction>> = {
  Permit: humanizePermit,
  PermitSingle: humanizePermit2Single,
  PermitBatch: humanizePermit2Batch,
  PermitTransferFrom: humanizePermit2Transfer,
  PermitWitnessTransferFrom: humanizePermit2WitnessTransfer,
  PermitBatchWitnessTransferFrom: humanizePermit2BatchWitnessTransfer,
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
  // first, so no other module can describe a hash message without its warning
  hashMessageModule,
  legendsMessageModule,
  openseaLoginMessageModule,
  zealyMessageModule,
  fallbackShortPlaintext
]

export { eip7702AuthorizationModule }
