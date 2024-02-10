"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAmbireV1LinkedAccount = exports.getSmartAccount = exports.getLegacyAccount = exports.getAccountDeployParams = void 0;
const ethers_1 = require("ethers");
const deploy_1 = require("../../consts/deploy");
const networks_1 = require("../../consts/networks");
const bytecode_1 = require("../proxyDeploy/bytecode");
const getAmbireAddressTwo_1 = require("../proxyDeploy/getAmbireAddressTwo");
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
function getLegacyAccount(key) {
    return {
        addr: key,
        label: '',
        pfp: '',
        associatedKeys: [key],
        creation: null
    };
}
exports.getLegacyAccount = getLegacyAccount;
async function getSmartAccount(address) {
    // Temporarily use the polygon network,
    // to be discussed which network we would use for
    // getBytocode once the contract is deployed on all of them
    const polygon = networks_1.networks.find((x) => x.id === 'polygon');
    if (!polygon)
        throw new Error('unable to find polygon network in consts');
    const priv = { addr: address, hash: true };
    const bytecode = await (0, bytecode_1.getBytecode)(polygon, [priv]);
    return {
        addr: (0, getAmbireAddressTwo_1.getAmbireAccountAddress)(deploy_1.AMBIRE_ACCOUNT_FACTORY, bytecode),
        label: '',
        pfp: '',
        associatedKeys: [address],
        creation: {
            factoryAddr: deploy_1.AMBIRE_ACCOUNT_FACTORY,
            bytecode,
            salt: ethers_1.ethers.toBeHex(0, 32)
        }
    };
}
exports.getSmartAccount = getSmartAccount;
const isAmbireV1LinkedAccount = (factoryAddr) => factoryAddr === '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA';
exports.isAmbireV1LinkedAccount = isAmbireV1LinkedAccount;
//# sourceMappingURL=account.js.map