const shortenAddress = (address, maxLength = 30) => address.length <= maxLength
    ? address
    : `${address.slice(0, maxLength / 2 - 1)}...${address.slice(-maxLength / 2 + 2)}`;
export default shortenAddress;
//# sourceMappingURL=shortenAddress.js.map