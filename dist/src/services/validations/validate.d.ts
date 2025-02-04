import isEmail from 'validator/es/lib/isEmail';
import { TokenResult } from '../../libs/portfolio';
type ValidateReturnType = {
    success: boolean;
    message: string;
};
declare const validateAddAuthSignerAddress: (address: string, selectedAcc: any) => ValidateReturnType;
declare const validateSendTransferAddress: (address: string, selectedAcc: string, addressConfirmed: any, isRecipientAddressUnknown: boolean, isRecipientHumanizerKnownTokenOrSmartContract: boolean, isUDAddress: boolean, isEnsAddress: boolean, isRecipientDomainResolving: boolean, isSWWarningVisible?: boolean, isSWWarningAgreed?: boolean) => ValidateReturnType;
declare const validateSendTransferAmount: (amount: string, maxAmount: number, maxAmountInFiat: number, selectedAsset: TokenResult) => ValidateReturnType;
declare const validateSendNftAddress: (address: string, selectedAcc: any, addressConfirmed: any, isRecipientAddressUnknown: boolean, isRecipientHumanizerKnownTokenOrSmartContract: boolean, metadata: any, selectedNetwork: any, network: any, isUDAddress: boolean, isEnsAddress: boolean, isRecipientDomainResolving: boolean) => ValidateReturnType;
declare const isValidCode: (code: string) => boolean;
declare const isValidPassword: (password: string) => boolean;
declare function isValidURL(url: string): boolean;
export { isEmail, validateAddAuthSignerAddress, validateSendTransferAddress, validateSendTransferAmount, validateSendNftAddress, isValidCode, isValidPassword, isValidURL };
//# sourceMappingURL=validate.d.ts.map