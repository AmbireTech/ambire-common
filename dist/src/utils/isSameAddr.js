import { getAddress } from 'ethers';
const isSameAddr = (one, two) => {
    return getAddress(one) === getAddress(two);
};
export default isSameAddr;
//# sourceMappingURL=isSameAddr.js.map