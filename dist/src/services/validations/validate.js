"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidURL = exports.isValidPassword = exports.isValidCode = exports.validateSendNftAddress = exports.validateSendTransferAmount = exports.validateSendTransferAddress = exports.validateAddAuthSignerAddress = exports.isEmail = void 0;
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
const validateSendTransferAddress = (address, selectedAcc, addressConfirmed, isRecipientAddressUnknown, isRecipientHumanizerKnownTokenOrSmartContract, isUDAddress, isEnsAddress, isRecipientDomainResolving, isSWWarningVisible, isSWWarningAgreed) => {
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
        !isUDAddress &&
        !isEnsAddress &&
        !isRecipientDomainResolving) {
        return {
            success: false,
            message: "You're trying to send to an unknown address. If you're really sure, confirm using the checkbox below."
        };
    }
    if (isRecipientAddressUnknown &&
        !addressConfirmed &&
        (isUDAddress || isEnsAddress) &&
        !isRecipientDomainResolving) {
        const name = isUDAddress ? 'Unstoppable domain' : 'Ethereum Name Service';
        return {
            success: false,
            message: `You're trying to send to an unknown ${name}. If you really trust the person who gave it to you, confirm using the checkbox below.`
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
const validateSendNftAddress = (address, selectedAcc, addressConfirmed, isRecipientAddressUnknown, isRecipientHumanizerKnownTokenOrSmartContract, metadata, selectedNetwork, network, isUDAddress, isEnsAddress, isRecipientDomainResolving) => {
    const isValidAddr = validateSendTransferAddress(address, selectedAcc, addressConfirmed, isRecipientAddressUnknown, isRecipientHumanizerKnownTokenOrSmartContract, isUDAddress, isEnsAddress, isRecipientDomainResolving);
    if (!isValidAddr.success)
        return isValidAddr;
    if (metadata &&
        selectedAcc &&
        metadata.owner?.address.toLowerCase() !== selectedAcc.toLowerCase()) {
        return {
            success: false,
            message: "The NFT you're trying to send is not owned by you!"
        };
    }
    if (selectedNetwork && network && selectedNetwork.id !== network) {
        return {
            success: false,
            message: 'The selected network is not the correct one.'
        };
    }
    return { success: true, message: '' };
};
exports.validateSendNftAddress = validateSendNftAddress;
const isValidCode = (code) => code.length === 6;
exports.isValidCode = isValidCode;
const isValidPassword = (password) => password.length >= 8;
exports.isValidPassword = isValidPassword;
function isValidURL(url) {
    const urlRegex = /^(?:https?|ftp):\/\/(?:\w+:{0,1}\w*@)?(?:\S+)(?::\d+)?(?:\/|\/(?:[\w#!:.?+=&%@!\-\/]))?$/;
    return urlRegex.test(url);
}
exports.isValidURL = isValidURL;
//# sourceMappingURL=validate.js.map