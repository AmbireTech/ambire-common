import isEmail from 'validator/lib/isEmail';
import { Account, AccountStates } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { AddressPoisoningMatch } from '../../interfaces/transfer';
import { TokenResult } from '../../libs/portfolio';
export type Validation = {
    message: string;
    /** Severity levels:
     * - 'error' - Critical validation failures that block the transaction
     * - 'warning' - Important information user should know but transaction can proceed
     * - 'info' - Neutral informational messages
     * - 'success' - Green confirmation message
     **/
    severity: 'info' | 'warning' | 'error' | 'success';
    id?: 'insufficient_amount' | 'resolving_domain';
};
export declare const validateAddress: (address: string) => Validation;
declare const validateAddAuthSignerAddress: (address: string, selectedAcc: any) => Validation;
declare function getTimeAgo(date: Date): string;
/**
 * The validation of the recipient of a transfer.
 * `shouldHold` (hold-to-proceed) is possible only for a warning: an error already disables the
 * buttons of the form, and a success message needs no confirmation from the user.
 * When `shouldHold` is true, the user must hold the button to proceed (a risk the user can accept).
 */
export type RecipientValidation = {
    severity: 'success' | 'error';
    message: string;
    shouldHold?: never;
} | {
    severity: 'warning';
    message: string;
    shouldHold?: boolean;
};
declare const validateSendTransferAddress: (address: string, selectedAccAddr: string, addressConfirmed: boolean, isRecipientAddressUnknown: boolean, isRecipientHumanizerKnownTokenOrSmartContract: boolean, isRecipientDomainResolving: boolean, networks: Network[], accountStates: AccountStates, recepientAccount?: Account, chainId?: bigint, isRecipientAddressFirstTimeSend?: boolean, lastRecipientTransactionDate?: Date | null, addressPoisoningMatch?: AddressPoisoningMatch | null, recipientDomainAddressChange?: {
    previousAddress: string;
} | null, isRecipientAddressBlacklisted?: boolean, isRecipientAddressViewOnly?: boolean) => RecipientValidation;
declare const validateSendTransferAmount: (amount: string, selectedAsset: TokenResult) => Validation;
declare const isValidCode: (code: string) => boolean;
declare const isValidPassword: (password: string) => boolean;
declare function isValidURL(url: string): boolean;
declare const isValidHostname: (str: string) => boolean;
export { isEmail, isValidCode, isValidPassword, isValidURL, isValidHostname, getTimeAgo, validateAddAuthSignerAddress, validateSendTransferAddress, validateSendTransferAmount };
//# sourceMappingURL=validate.d.ts.map