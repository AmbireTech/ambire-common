import { PrivacyPoolsSendForm } from '../../interfaces/privacyPools'
import { IUiController, View } from '../../interfaces/ui'

/** The Send screen of a Privacy Pools account, whose form outlives a closed popup. */
const SEND_ROUTE = 'privacy-pools-send'

const EMPTY_SEND_FORM: PrivacyPoolsSendForm = {
  recipientFieldValue: '',
  tokenId: '',
  amount: '',
  amountInFiat: '',
  amountFieldMode: 'token'
}

/**
 * The selected Privacy Pools account's Send form, and which view changes leave it. Reads the open
 * views only: `PrivacyPoolsController` subscribes to their changes.
 */
export class PrivacyPoolsSendFormState {
  #ui: IUiController

  /** Dropped on switching accounts, like the regular one. */
  form: PrivacyPoolsSendForm = EMPTY_SEND_FORM

  /** Changes when the form is cleared here, so the screen drops what it holds locally. */
  resetCounter = 0

  constructor(ui: IUiController) {
    this.#ui = ui
  }

  /** Whether the form has anything the user would lose. Reopens the popup on that screen. */
  get hasPersistedForm(): boolean {
    const { recipientFieldValue, amount, amountInFiat } = this.form

    return !!(recipientFieldValue || amount || amountInFiat)
  }

  update(update: Partial<PrivacyPoolsSendForm>) {
    this.form = { ...this.form, ...update }
  }

  /** Returns whether there was anything to clear. */
  clear(): boolean {
    if (this.form === EMPTY_SEND_FORM) return false

    this.form = EMPTY_SEND_FORM
    this.resetCounter += 1

    return true
  }

  // Leaving the screen for another route drops the form, as on the regular Send
  isLeftByViewUpdate(view: View): boolean {
    if (view.previousRoute !== SEND_ROUTE || view.currentRoute === SEND_ROUTE) return false

    return !this.#hasSendViewOpen()
  }

  // A closed popup keeps the form, and the proof keeps running for it, while the side panel and a
  // tab start fresh on reopen
  isLeftByViewRemoval(view: View): boolean {
    if (view.currentRoute !== SEND_ROUTE || this.#hasSendViewOpen()) return false

    return !(view.type === 'popup' && this.hasPersistedForm)
  }

  #hasSendViewOpen() {
    return this.#ui.views.some((view) => view.currentRoute === SEND_ROUTE)
  }
}
