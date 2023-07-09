"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccountDeployParams = void 0;
const ethers_1 = require("ethers");
// returns to, data
function getAccountDeployParams(account) {
    if (account.creation === null)
        throw new Error('tried to get deployment params for an EOA');
    const factory = new ethers_1.Interface(['function deploy(bytes calldata code, uint256 salt) external']);
    return [
        account.creation.factoryAddr,
        factory.encodeFunctionData('deploy', [account.creation.bytecode, account.creation.salt])
    ];
}
exports.getAccountDeployParams = getAccountDeployParams;
//# sourceMappingURL=account.js.map