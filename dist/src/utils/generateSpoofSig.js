import { AbiCoder } from 'ethers';
const generateSpoofSig = (signer) => {
    const SPOOF_SIGTYPE = '03';
    const abiCoder = new AbiCoder();
    const signature = abiCoder.encode(['address'], [signer]) + SPOOF_SIGTYPE;
    return signature;
};
export default generateSpoofSig;
//# sourceMappingURL=generateSpoofSig.js.map