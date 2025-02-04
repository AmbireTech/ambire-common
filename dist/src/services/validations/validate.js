import { getAddress, parseUnits } from 'ethers';
import isEmail from 'validator/es/lib/isEmail';
import { getTokenAmount } from '../../libs/portfolio/helpers';
import { getSanitizedAmount } from '../../libs/transfer/amount';
import { isValidAddress } from '../address';
const validateAddress = (address) => {
    if (!(address && address.length)) {
        return {
            success: false,
            message: ''
        };
    }
    if (!(address && isValidAddress(address))) {
        return {
            success: false,
            message: 'Invalid address.'
        };
    }
    try {
        getAddress(address);
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
const validateSendTransferAddress = (address, selectedAcc, addressConfirmed, isRecipientAddressUnknown, isRecipientHumanizerKnownTokenOrSmartContract, isUDAddress, isEnsAddress, isRecipientDomainResolving, isSWWarningVisible, isSWWarningAgreed) => {
    // Basic validation is handled in the AddressInput component and we don't want to overwrite it.
    if (!isValidAddress(address) || isRecipientDomainResolving) {
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
const validateSendTransferAmount = (amount, maxAmount, maxAmountInFiat, selectedAsset) => {
    const sanitizedAmount = getSanitizedAmount(amount, selectedAsset.decimals);
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
            const currentAmount = parseUnits(sanitizedAmount, selectedAsset.decimals);
            if (currentAmount > getTokenAmount(selectedAsset)) {
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
const isValidCode = (code) => code.length === 6;
const isValidPassword = (password) => password.length >= 8;
function isValidURL(url) {
    const urlRegex = /^(?:https?|ftp):\/\/(?:\w+:{0,1}\w*@)?(?:\S+)(?::\d+)?(?:\/|\/(?:[\w#!:.?+=&%@!\-\/]))?$/;
    return urlRegex.test(url);
}
export { isEmail, validateAddAuthSignerAddress, validateSendTransferAddress, validateSendTransferAmount, validateSendNftAddress, isValidCode, isValidPassword, isValidURL };
//# sourceMappingURL=validate.js.map