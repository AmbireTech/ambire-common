import { PrivacyPoolsSendForm } from '../../interfaces/privacyPools';
import { IUiController, View } from '../../interfaces/ui';
/**
 * The selected Privacy Pools account's Send form, and which view changes leave it. Reads the open
 * views only: `PrivacyPoolsController` subscribes to their changes.
 */
export declare class PrivacyPoolsSendFormState {
    #private;
    /** Dropped on switching accounts, like the regular one. */
    form: PrivacyPoolsSendForm;
    /** Changes when the form is cleared here, so the screen drops what it holds locally. */
    resetCounter: number;
    constructor(ui: IUiController);
    /** Whether the form has anything the user would lose. Reopens the popup on that screen. */
    get hasPersistedForm(): boolean;
    update(update: Partial<PrivacyPoolsSendForm>): void;
    /** Returns whether there was anything to clear. */
    clear(): boolean;
    /**
     * Picks the token the view opened the screen for (`?chainId=1&address=0x...`, like the regular
     * Send). Returns whether the form changed.
     */
    isTokenPickedByViewUpdate(view: View): boolean;
    isLeftByViewUpdate(view: View): boolean;
    isLeftByViewRemoval(view: View): boolean;
}
//# sourceMappingURL=sendForm.d.ts.map