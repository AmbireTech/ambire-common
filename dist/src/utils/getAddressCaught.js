import { getAddress } from 'ethers';
/**
 * Wraps getAddress because it throws an error if the address is invalid.
 * Instead, this function will return an empty string if the address is invalid.
 */
const getAddressCaught = (address) => {
    try {
        const addr = getAddress(address);
        return addr;
    }
    catch (error) {
        console.error(`Invalid address: ${address}. Error:`, error);
        return '';
    }
};
export { getAddressCaught };
//# sourceMappingURL=getAddressCaught.js.map