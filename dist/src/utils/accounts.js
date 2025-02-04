const getIsViewOnly = (keys, accountKeys) => {
    return keys.every((k) => !accountKeys.includes(k.addr));
};
export { getIsViewOnly };
//# sourceMappingURL=accounts.js.map