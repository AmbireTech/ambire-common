import { isHexString } from 'ethers'

import { HumanizerPlainTextMessageModule } from '../interfaces'
import { getAction, getText, getWarning } from '../utils'

/** The size of a hash in bytes, e.g. of a Safe{WALLET} transaction */
const HASH_BYTE_LENGTH = 32

/** Shown in place of a description, as what a hash stands for can't be read back from it */
export const HASH_MESSAGE_TITLE = "Warning! You can't verify what you're signing."

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
export const hashMessageModule: HumanizerPlainTextMessageModule = (message) => {
  const { message: messageHex } = message.content
  if (typeof messageHex !== 'string' || !isHexString(messageHex, HASH_BYTE_LENGTH)) return null

  return {
    fullVisualization: [getAction(HASH_MESSAGE_TITLE), getText(messageHex)],
    warnings: [
      getWarning(
        "This signature could authorize hidden transactions, including moving funds or changing control of a shared account. If an app asked you to sign this to log in, reject it. Only proceed if you know exactly what you're authorizing.",
        HASH_MESSAGE_WARNING_CODE
      )
    ]
  }
}
