import { isHexString } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule } from '../interfaces'
import { getAction, getLabel, getText, getWarning } from '../utils'

/** The size of a hash in bytes, e.g. of a Safe{WALLET} transaction */
const HASH_BYTE_LENGTH = 32

/** The code of the warning shown when a plain text message is exactly a hash */
export const HASH_MESSAGE_WARNING_CODE = 'HASH_MESSAGE_APPROVAL'

/**
 * Describes a plain text (`personal_sign`) message that is exactly 32 bytes long, i.e. a hash.
 *
 * Signing it is not harmless like signing a login message: a Safe{WALLET} accepts an owner's
 * signature of a transaction hash in this format as that owner's approval of the transaction
 * (the same as `approveHash`), and other contracts treat such a signature as consent to act. What
 * the hash stands for can't be read back from it, so the user is warned instead of being shown it
 * as a plain message.
 *
 * Every 32-byte message is treated this way, even one that happens to read as text, because the
 * hash of a transaction can be made to look like text by trying many slightly different versions
 * of it. The warning doesn't block signing, as Safe{WALLET} itself asks some owners (e.g. ones
 * signing with a hardware wallet) to approve its transactions this way.
 */
export const hashMessageModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'message') return { fullVisualization: [] }

  const { message: messageHex } = message.content
  if (typeof messageHex !== 'string' || !isHexString(messageHex, HASH_BYTE_LENGTH))
    return { fullVisualization: [] }

  return {
    fullVisualization: [
      getAction('Approve a hidden action'),
      getLabel('with code'),
      getText(messageHex)
    ],
    warnings: [
      getWarning(
        "Signing this can approve an action that can't be shown here, for example a transaction of a shared account you co-own (like a Safe), which could move its funds or change who controls it. Logging in to an app never asks for this. Only sign if you started this action yourself",
        HASH_MESSAGE_WARNING_CODE
      )
    ]
  }
}
