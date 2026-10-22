"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSendTransferAmount = exports.validateSendTransferAddress = exports.validateAddAuthSignerAddress = exports.isValidHostname = exports.isValidPassword = exports.isValidCode = exports.isEmail = exports.validateAddress = void 0;
exports.isValidURL = isValidURL;
exports.getTimeAgo = getTimeAgo;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const isEmail_1 = tslib_1.__importDefault(require("validator/lib/isEmail"));
exports.isEmail = isEmail_1.default;
const networks_1 = require("../../libs/networks/networks");
const helpers_1 = require("../../libs/portfolio/helpers");
const amount_1 = require("../../libs/transfer/amount");
const shortenAddress_1 = tslib_1.__importDefault(require("../../utils/shortenAddress"));
const address_1 = require("../address");
const validateAddress = (address) => {
    if (!(address && address.length)) {
        return {
            severity: 'error',
            message: ''
        };
    }
    if (!(address && (0, address_1.isValidAddress)(address))) {
        return {
            severity: 'error',
            message: 'Invalid address.'
        };
    }
    try {
        (0, ethers_1.getAddress)(address);
    }
    catch {
        return {
            severity: 'error',
            message: 'Invalid checksum. Verify the address and try again.'
        };
    }
    return { severity: 'success', message: '' };
};
exports.validateAddress = validateAddress;
const validateAddAuthSignerAddress = (address, selectedAcc) => {
    const isValidAddr = (0, exports.validateAddress)(address);
    if (isValidAddr.severity === 'error')
        return isValidAddr;
    if (address && selectedAcc && address === selectedAcc) {
        return {
            severity: 'error',
            message: "You can't send to the same address you’re sending from."
        };
    }
    return { severity: 'success', message: '' };
};
exports.validateAddAuthSignerAddress = validateAddAuthSignerAddress;
const FIRST_TIME_SEND_MESSAGE = 'First time sending to this address.';
const FIRST_TIME_SEND_IN_ADDRESS_BOOK_MESSAGE = FIRST_TIME_SEND_MESSAGE; // same same as above, but keep it separate just in case
const VIEW_ONLY_RECIPIENT_MESSAGE = "This account is view-only in Ambire, so you can't move funds out of it from here. Make sure you can access it before you send.";
// Keep poisoning warnings readable with compact address previews.
// We size the preview based on the strongest symmetric part of the match:
// 4-left/4-right uses 0x + 6...6, while stronger matches such as 5-left/5-right,
// 6-left/5-right or 6-left/6-right use 0x + 8...8 for more clarity.
const ADDRESS_POISONING_MESSAGE_VISIBLE_CHARS_DEFAULT = 6;
const ADDRESS_POISONING_MESSAGE_VISIBLE_CHARS_EXTENDED = 8;
const getAddressPoisoningWarningMessage = (matchedAddress) => `Possible address poisoning: this new address looks similar to ${matchedAddress} that you have interacted with before. Proceed with caution.`;
const formatAddressPoisoningMatchForMessage = ({ matchedAddress, matchedPrefixCharsCount, matchedSuffixCharsCount }) => {
    let normalizedAddress = matchedAddress;
    try {
        normalizedAddress = (0, ethers_1.getAddress)(matchedAddress);
    }
    catch {
        // keep original if checksum normalization fails
    }
    const strongestSymmetricMatch = Math.max(matchedPrefixCharsCount, matchedSuffixCharsCount);
    const visibleChars = strongestSymmetricMatch >= 5
        ? ADDRESS_POISONING_MESSAGE_VISIBLE_CHARS_EXTENDED
        : ADDRESS_POISONING_MESSAGE_VISIBLE_CHARS_DEFAULT;
    const fixedPreviewLength = visibleChars * 2 + 5; // 0x + left + ... + right
    return (0, shortenAddress_1.default)(normalizedAddress, fixedPreviewLength, visibleChars);
};
function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    if (diffMinutes < 1)
        return 'just now';
    if (diffMinutes < 60)
        return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 24)
        return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 1)
        return 'yesterday';
    if (diffDays <= 31)
        return `${diffDays} days ago`;
    const diffMonths = Math.floor(diffDays / 30.44); // Average days per month
    if (diffMonths < 12)
        return `${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`;
    const diffYears = Math.round(diffMonths / 12);
    return `${diffYears} ${diffYears === 1 ? 'year' : 'years'} ago`;
}
const validateSendTransferAddress = (address, selectedAccAddr, addressConfirmed, isRecipientAddressUnknown, isRecipientHumanizerKnownTokenOrSmartContract, isRecipientDomainResolving, networks, accountStates, recepientAccount, chainId, isRecipientAddressFirstTimeSend, lastRecipientTransactionDate, addressPoisoningMatch, recipientDomainAddressChange, isRecipientAddressBlacklisted, isRecipientAddressViewOnly) => {
    // Basic validation is handled in the AddressInput component and we don't want to overwrite it.
    if (!(0, address_1.isValidAddress)(address) || isRecipientDomainResolving) {
        return {
            message: '',
            severity: 'success'
        };
    }
    // The single source of truth for both the message under the input and the hold-to-proceed state
    // of the buttons, so a check can't require a hold without also explaining why.
    // All the checks run and the most important result that applies decides everything:
    // 1. an error - it disables the buttons of the form
    // 2. a warning that requires a hold - the user must hold the button to proceed
    // 3. a warning that doesn't require a hold
    // 4. a success message
    // So a plain warning can't hide a hold. The order of the checks below only decides between
    // results of the same importance (the first one wins).
    const checks = [
        // A known scam address is the most severe problem, so it takes priority over every other message.
        // The severity is 'error' so that the buttons of the form stay disabled - sending to a known scam
        // address is never something we let the user proceed with.
        () => {
            if (!isRecipientAddressBlacklisted)
                return undefined;
            return {
                message: 'This address is known for stealing funds. Anything you send to it will be lost.',
                severity: 'error'
            };
        },
        () => {
            if (!isRecipientHumanizerKnownTokenOrSmartContract)
                return undefined;
            return {
                message: 'You are trying to send tokens to a smart contract. Doing so would burn them.',
                severity: 'error'
            };
        },
        // A domain the user sent to before now resolves to a different address - it may have expired and
        // been re-pointed.
        () => {
            if (!recipientDomainAddressChange)
                return undefined;
            return {
                message: 'This name now resolves to a different address than the last time you sent to it. Verify the new recipient before proceeding.',
                severity: 'warning',
                shouldHold: true
            };
        },
        // poisoning detected - require hold-to-proceed as an additional safety step
        () => {
            if (!addressPoisoningMatch)
                return undefined;
            return {
                message: getAddressPoisoningWarningMessage(formatAddressPoisoningMatchForMessage(addressPoisoningMatch)),
                severity: 'warning',
                shouldHold: true
            };
        },
        () => {
            if (!isRecipientAddressViewOnly)
                return undefined;
            return {
                message: VIEW_ONLY_RECIPIENT_MESSAGE,
                severity: 'warning',
                shouldHold: true
            };
        },
        () => {
            if (address.toLowerCase() !== selectedAccAddr.toLowerCase())
                return undefined;
            return {
                message: "You're about to send funds back to yourself.",
                severity: 'warning'
            };
        },
        // check if the account is supported on the receiving network
        () => {
            if (!chainId)
                return undefined;
            const accountNetworks = (0, networks_1.getSupportedNetworks)(networks, accountStates, recepientAccount);
            const foundNetwork = accountNetworks.find((n) => n.chainId === chainId);
            if (!foundNetwork || !foundNetwork.isNotSupported || !foundNetwork.notSupportedReason) {
                return undefined;
            }
            return {
                message: foundNetwork.notSupportedReason,
                severity: 'warning'
            };
        },
        // The first time sending to an unknown address requires a hold until the user agrees. The
        // message stays the same after that, only the hold is released.
        () => {
            if (!isRecipientAddressFirstTimeSend)
                return undefined;
            return {
                message: isRecipientAddressUnknown
                    ? FIRST_TIME_SEND_MESSAGE
                    : FIRST_TIME_SEND_IN_ADDRESS_BOOK_MESSAGE,
                severity: 'warning',
                shouldHold: isRecipientAddressUnknown && !addressConfirmed
            };
        },
        () => {
            if (!lastRecipientTransactionDate)
                return undefined;
            return {
                message: `Last transaction to this address was ${getTimeAgo(lastRecipientTransactionDate)}.`,
                severity: 'success'
            };
        }
    ];
    const relevantChecks = checks
        .map((check) => check())
        .filter((result) => !!result);
    return (relevantChecks.find((result) => result.severity === 'error') ||
        relevantChecks.find((result) => result.severity === 'warning' && result.shouldHold) ||
        relevantChecks.find((result) => result.severity === 'warning') ||
        relevantChecks.find((result) => result.severity === 'success') || {
        severity: 'success',
        message: ''
    });
};
exports.validateSendTransferAddress = validateSendTransferAddress;
const validateSendTransferAmount = (amount, selectedAsset) => {
    const sanitizedAmount = (0, amount_1.getSanitizedAmount)(amount, selectedAsset.decimals);
    if (!(sanitizedAmount && sanitizedAmount.length)) {
        return {
            severity: 'error',
            message: ''
        };
    }
    if (!(sanitizedAmount && Number(sanitizedAmount) > 0)) {
        // The user has entered an amount that is outside of the valid range.
        if (Number(amount) > 0 && selectedAsset.decimals && selectedAsset.decimals > 0) {
            return {
                severity: 'error',
                message: `The amount must be greater than 0.${'0'.repeat(selectedAsset.decimals - 1)}1.`
            };
        }
        return {
            severity: 'error',
            message: 'The amount must be greater than 0.'
        };
    }
    try {
        if (sanitizedAmount && selectedAsset && selectedAsset.decimals) {
            if (Number(sanitizedAmount) < 1 / 10 ** selectedAsset.decimals)
                return {
                    message: 'Token amount too low.',
                    severity: 'error'
                };
            const currentAmount = (0, ethers_1.parseUnits)(sanitizedAmount, selectedAsset.decimals);
            if (currentAmount > (0, helpers_1.getTokenAmount)(selectedAsset)) {
                return {
                    message: 'Insufficient amount.',
                    severity: 'error',
                    id: 'insufficient_amount'
                };
            }
        }
    }
    catch {
        // Keep original behavior but avoid adding new console usage beyond existing
        // callers may log if needed; return a warning indicating invalid amount.
        return {
            message: 'Invalid amount.',
            severity: 'error'
        };
    }
    return { severity: 'success', message: '' };
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
const isValidHostname = (str) => {
    // Matches hostnames like "google.com", "app.uniswap.org", etc.
    const hostnameRegex = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;
    return hostnameRegex.test(str);
};
exports.isValidHostname = isValidHostname;
//# sourceMappingURL=validate.js.map