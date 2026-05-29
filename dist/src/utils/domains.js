const getAddressFromAddressState = (addressState) => {
    return (addressState.resolvedAddress || addressState.fieldValue || '').trim();
};
export { getAddressFromAddressState };
//# sourceMappingURL=domains.js.map