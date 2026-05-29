import isEmail from 'validator/lib/isEmail';
import { Account, AccountStates } from '@/interfaces/account';
import { Network } from '@/interfaces/network';
import { AddressPoisoningMatch } from '@/interfaces/transfer';
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
declare const validateSendTransferAddress: (address: string, selectedAccAddr: string, addressConfirmed: any, isRecipientAddressUnknown: boolean, isRecipientHumanizerKnownTokenOrSmartContract: boolean, isDomain: boolean, isRecipientDomainResolving: boolean, networks: Network[], accountStates: AccountStates, recepientAccount?: Account, chainId?: bigint, isRecipientAddressFirstTimeSend?: boolean, lastRecipientTransactionDate?: Date | null, addressPoisoningMatch?: AddressPoisoningMatch | null) => Validation;
declare const validateSendTransferAmount: (amount: string, selectedAsset: TokenResult) => Validation;
declare const isValidCode: (code: string) => boolean;
declare const isValidPassword: (password: string) => boolean;
declare function isValidURL(url: string): boolean;
declare const isValidHostname: (str: string) => boolean;
export { isEmail, isValidCode, isValidPassword, isValidURL, isValidHostname, validateAddAuthSignerAddress, validateSendTransferAddress, validateSendTransferAmount };
//# sourceMappingURL=validate.d.ts.map