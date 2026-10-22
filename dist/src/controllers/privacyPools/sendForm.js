"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivacyPoolsSendFormState = void 0;
const privacyPools_1 = require("../../consts/privacyPools");
/** The Send screen of a Privacy Pools account, whose form outlives a closed popup. */
const SEND_ROUTE = 'privacy-pools-send';
const EMPTY_SEND_FORM = {
    recipientFieldValue: '',
    tokenId: '',
    amount: '',
    amountInFiat: '',
    amountFieldMode: 'token'
};
/**
 * The selected Privacy Pools account's Send form, and which view changes leave it. Reads the open
 * views only: `PrivacyPoolsController` subscribes to their changes.
 */
class PrivacyPoolsSendFormState {
    #ui;
    /** Dropped on switching accounts, like the regular one. */
    form = EMPTY_SEND_FORM;
    /** Changes when the form is cleared here, so the screen drops what it holds locally. */
    resetCounter = 0;
    constructor(ui) {
        this.#ui = ui;
    }
    /** Whether the form has anything the user would lose. Reopens the popup on that screen. */
    get hasPersistedForm() {
        const { recipientFieldValue, amount, amountInFiat } = this.form;
        return !!(recipientFieldValue || amount || amountInFiat);
    }
    update(update) {
        this.form = { ...this.form, ...update };
    }
    /** Returns whether there was anything to clear. */
    clear() {
        if (this.form === EMPTY_SEND_FORM)
            return false;
        this.form = EMPTY_SEND_FORM;
        this.resetCounter += 1;
        return true;
    }
    /**
     * Picks the token the view opened the screen for (`?chainId=1&address=0x...`, like the regular
     * Send). Returns whether the form changed.
     */
    isTokenPickedByViewUpdate(view) {
        if (view.currentRoute !== SEND_ROUTE)
            return false;
        const { chainId, address } = view.searchParams || {};
        if (!chainId || !address)
            return false;
        const tokenId = (0, privacyPools_1.getPrivacyPoolsTokenId)(chainId, address);
        if (tokenId === this.form.tokenId)
            return false;
        this.update({ tokenId });
        return true;
    }
    // Leaving the screen for another route drops the form, as on the regular Send
    isLeftByViewUpdate(view) {
        if (view.previousRoute !== SEND_ROUTE || view.currentRoute === SEND_ROUTE)
            return false;
        return !this.#hasSendViewOpen();
    }
    // A closed popup keeps the form, and the proof keeps running for it, while the side panel and a
    // tab start fresh on reopen
    isLeftByViewRemoval(view) {
        if (view.currentRoute !== SEND_ROUTE || this.#hasSendViewOpen())
            return false;
        return !(view.type === 'popup' && this.hasPersistedForm);
    }
    #hasSendViewOpen() {
        return this.#ui.views.some((view) => view.currentRoute === SEND_ROUTE);
    }
}
exports.PrivacyPoolsSendFormState = PrivacyPoolsSendFormState;
//# sourceMappingURL=sendForm.js.map