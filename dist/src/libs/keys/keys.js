"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccountKeysCount = exports.getExistingKeyLabel = exports.getDefaultKeyLabel = exports.DEFAULT_KEY_LABEL_PATTERN = void 0;
exports.DEFAULT_KEY_LABEL_PATTERN = /^Key (\d+)$/;
const getDefaultKeyLabel = (prevKeys, i) => {
    const number = prevKeys.length + i + 1;
    return `Key ${number}`;
};
exports.getDefaultKeyLabel = getDefaultKeyLabel;
const getExistingKeyLabel = (keys, addr, accountPickerType) => {
    let key;
    if (accountPickerType) {
        key = keys.find((k) => k.addr === addr && k.type === accountPickerType);
    }
    else {
        key = keys.find((k) => k.addr === addr);
    }
    return key?.label;
};
exports.getExistingKeyLabel = getExistingKeyLabel;
const getAccountKeysCount = ({ accountAddr, accounts, keys }) => {
    const account = accounts.find((x) => x.addr === accountAddr);
    return keys.filter((x) => account?.associatedKeys.includes(x.addr)).length;
};
exports.getAccountKeysCount = getAccountKeysCount;
//# sourceMappingURL=keys.js.map