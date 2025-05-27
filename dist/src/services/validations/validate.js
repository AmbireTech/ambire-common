"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidPassword = exports.isValidCode = exports.validateSendTransferAmount = exports.validateSendTransferAddress = exports.validateAddAuthSignerAddress = exports.isEmail = void 0;
exports.isValidURL = isValidURL;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const isEmail_1 = tslib_1.__importDefault(require("validator/es/lib/isEmail"));
exports.isEmail = isEmail_1.default;
const helpers_1 = require("../../libs/portfolio/helpers");
const amount_1 = require("../../libs/transfer/amount");
const address_1 = require("../address");
const validateAddress = (address) => {
    if (!(address && address.length)) {
        return {
            success: false,
            message: ''
        };
    }
    if (!(address && (0, address_1.isValidAddress)(address))) {
        return {
            success: false,
            message: 'Invalid address.'
        };
    }
    try {
        (0, ethers_1.getAddress)(address);
    }
    catch {
        return {
            success: false,
            message: 'Invalid checksum. Verify the address and try again.'
        };
    }
    return { success: true, message: '' };
};
const validateAddAuthSignerAddress = (address, selectedAcc) => {
    const isValidAddr = validateAddress(address);
    if (!isValidAddr.success)
        return isValidAddr;
    if (address && selectedAcc && address === selectedAcc) {
        return {
            success: false,
            message: 'The entered address should be different than your own account address.'
        };
    }
    return { success: true, message: '' };
};
exports.validateAddAuthSignerAddress = validateAddAuthSignerAddress;
const NOT_IN_ADDRESS_BOOK_MESSAGE = "This address isn't in your Address Book. Double-check the details before confirming.";
const validateSendTransferAddress = (address, selectedAcc, addressConfirmed, isRecipientAddressUnknown, isRecipientHumanizerKnownTokenOrSmartContract, isEnsAddress, isRecipientDomainResolving, isSWWarningVisible, isSWWarningAgreed) => {
    // Basic validation is handled in the AddressInput component and we don't want to overwrite it.
    if (!(0, address_1.isValidAddress)(address) || isRecipientDomainResolving) {
        return {
            success: true,
            message: ''
        };
    }
    if (selectedAcc && address.toLowerCase() === selectedAcc.toLowerCase()) {
        return {
            success: false,
            message: 'The entered address should be different than the your own account address.'
        };
    }
    if (isRecipientHumanizerKnownTokenOrSmartContract) {
        return {
            success: false,
            message: 'You are trying to send tokens to a smart contract. Doing so would burn them.'
        };
    }
    if (isRecipientAddressUnknown &&
        !addressConfirmed &&
        !isEnsAddress &&
        !isRecipientDomainResolving) {
        return {
            success: false,
            message: NOT_IN_ADDRESS_BOOK_MESSAGE
        };
    }
    if (isRecipientAddressUnknown &&
        !addressConfirmed &&
        isEnsAddress &&
        !isRecipientDomainResolving) {
        return {
            success: false,
            message: NOT_IN_ADDRESS_BOOK_MESSAGE
        };
    }
    if (isRecipientAddressUnknown && addressConfirmed && isSWWarningVisible && !isSWWarningAgreed) {
        return {
            success: false,
            message: 'Please confirm that the recipient address is not an exchange.'
        };
    }
    return { success: true, message: '' };
};
exports.validateSendTransferAddress = validateSendTransferAddress;
const validateSendTransferAmount = (amount, maxAmount, maxAmountInFiat, selectedAsset) => {
    const sanitizedAmount = (0, amount_1.getSanitizedAmount)(amount, selectedAsset.decimals);
    if (!(sanitizedAmount && sanitizedAmount.length)) {
        return {
            success: false,
            message: ''
        };
    }
    if (!(sanitizedAmount && Number(sanitizedAmount) > 0)) {
        return {
            success: false,
            message: 'The amount must be greater than 0.'
        };
    }
    try {
        if (sanitizedAmount && selectedAsset && selectedAsset.decimals) {
            if (Number(sanitizedAmount) < 1 / 10 ** selectedAsset.decimals)
                return {
                    success: false,
                    message: 'Token amount too low.'
                };
            const currentAmount = (0, ethers_1.parseUnits)(sanitizedAmount, selectedAsset.decimals);
            if (currentAmount > (0, helpers_1.getTokenAmount)(selectedAsset)) {
                return {
                    success: false,
                    message: `The amount is greater than the asset's balance: ${Number(maxAmount) || 0} ${selectedAsset?.symbol}${maxAmountInFiat ? `/ ${Number(maxAmountInFiat)} USD.` : ''}`
                };
            }
        }
    }
    catch (e) {
        console.error(e);
        return {
            success: false,
            message: 'Invalid amount.'
        };
    }
    return { success: true, message: '' };
};
exports.validateSendTransferAmount = validateSendTransferAmount;
const isValidCode = (code) => code.length === 6;
exports.isValidCode = isValidCode;
const isValidPassword = (password) => password.length >= 8;
exports.isValidPassword = isValidPassword;
function isValidURL(url) {
    const urlRegex = /^(?:https?|ftp):\/\/(?:\w+:{0,1}\w*@)?(?:\S+)(?::\d+)?(?:\/|\/(?:[\w#!:.?+=&%@!\-\/]))?$/;
    return urlRegex.test(url);
}
//# sourceMappingURL=validate.js.map