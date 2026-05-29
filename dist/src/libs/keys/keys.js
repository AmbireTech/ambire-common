export const DEFAULT_KEY_LABEL_PATTERN = /^Key (\d+)$/;
export const getDefaultKeyLabel = (prevKeys, i) => {
    const number = prevKeys.length + i + 1;
    return `Key ${number}`;
};
export const getExistingKeyLabel = (keys, addr, accountPickerType) => {
    let key;
    if (accountPickerType) {
        key = keys.find((k) => k.addr === addr && k.type === accountPickerType);
    }
    else {
        key = keys.find((k) => k.addr === addr);
    }
    return key?.label;
};
export const getAccountKeysCount = ({ accountAddr, accounts, keys }) => {
    const account = accounts.find((x) => x.addr === accountAddr);
    return keys.filter((x) => account?.associatedKeys.includes(x.addr)).length;
};
//# sourceMappingURL=keys.js.map