import { getCreate2Address, keccak256, toBeHex } from 'ethers';
export function getAmbireAccountAddress(factoryAddress, bytecode) {
    return getCreate2Address(factoryAddress, toBeHex(0, 32), keccak256(bytecode));
}
//# sourceMappingURL=getAmbireAddressTwo.js.map