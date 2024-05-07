"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isErc4337Broadcast = exports.getPaymasterSpoof = exports.getTargetEdgeCaseNonce = exports.toUserOperation = exports.calculateCallDataCost = void 0;
const ethers_1 = require("ethers");
const accountOp_1 = require("../accountOp/accountOp");
const AmbireAccount_json_1 = __importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireAccountFactory_json_1 = __importDefault(require("../../../contracts/compiled/AmbireAccountFactory.json"));
const deploy_1 = require("../../consts/deploy");
const signatures_1 = require("../../consts/signatures");
function calculateCallDataCost(callData) {
    if (callData === '0x')
        return 0n;
    const bytes = Buffer.from(callData.substring(2));
    const nonZeroBytes = BigInt(bytes.filter((b) => b).length);
    const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes);
    return zeroBytes * 4n + nonZeroBytes * 16n;
}
exports.calculateCallDataCost = calculateCallDataCost;
function toUserOperation(account, accountState, accountOp) {
    let initCode = '0x';
    let isEdgeCase = false;
    // if the account is not deployed, prepare the deploy in the initCode
    if (!accountState.isDeployed) {
        if (!account.creation)
            throw new Error('Account creation properties are missing');
        const ambireAccountFactory = new ethers_1.ethers.BaseContract(account.creation.factoryAddr, AmbireAccountFactory_json_1.default.abi);
        initCode = ethers_1.ethers.hexlify(ethers_1.ethers.concat([
            account.creation.factoryAddr,
            ambireAccountFactory.interface.encodeFunctionData('deploy', [
                account.creation.bytecode,
                account.creation.salt
            ])
        ]));
        isEdgeCase = true;
    }
    // give permissions to the entry if there aren't nay
    const ambireAccount = new ethers_1.ethers.BaseContract(accountOp.accountAddr, AmbireAccount_json_1.default.abi);
    if (!accountState.isErc4337Enabled) {
        const givePermsToEntryPointData = ambireAccount.interface.encodeFunctionData('setAddrPrivilege', [deploy_1.ERC_4337_ENTRYPOINT, deploy_1.ENTRY_POINT_MARKER]);
        accountOp.calls.push({
            to: accountOp.accountAddr,
            value: 0n,
            data: givePermsToEntryPointData
        });
        isEdgeCase = true;
    }
    // get estimation calldata
    let callData;
    if (isEdgeCase) {
        const abiCoder = new ethers_1.ethers.AbiCoder();
        const spoofSig = abiCoder.encode(['address'], [account.associatedKeys[0]]) + signatures_1.SPOOF_SIGTYPE;
        callData = ambireAccount.interface.encodeFunctionData('executeMultiple', [
            [[(0, accountOp_1.getSignableCalls)(accountOp), spoofSig]]
        ]);
    }
    else {
        callData = ambireAccount.interface.encodeFunctionData('executeBySender', [
            (0, accountOp_1.getSignableCalls)(accountOp)
        ]);
    }
    // 27000n initial + deploy, callData, paymaster, signature
    let preVerificationGas = 27000n;
    preVerificationGas += calculateCallDataCost(initCode);
    preVerificationGas += calculateCallDataCost(getPaymasterSpoof());
    preVerificationGas += calculateCallDataCost('0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'); // signature
    accountOp.asUserOperation = {
        sender: accountOp.accountAddr,
        nonce: ethers_1.ethers.toBeHex(accountState.erc4337Nonce),
        initCode,
        callData,
        preVerificationGas: ethers_1.ethers.toBeHex(preVerificationGas),
        callGasLimit: ethers_1.ethers.toBeHex(150000), // hardcoded fake for estimation
        verificationGasLimit: ethers_1.ethers.toBeHex(150000), // hardcoded fake for estimation
        maxFeePerGas: ethers_1.ethers.toBeHex(100),
        maxPriorityFeePerGas: ethers_1.ethers.toBeHex(100),
        paymasterAndData: '0x',
        signature: '0x',
        isEdgeCase
    };
    return accountOp;
}
exports.toUserOperation = toUserOperation;
/**
 * Get the target nonce we're expecting in validateUserOp
 * when we're going through the edge case
 *
 * @param UserOperation userOperation
 * @returns hex string
 */
function getTargetEdgeCaseNonce(userOperation) {
    const abiCoder = new ethers_1.ethers.AbiCoder();
    return `0x${ethers_1.ethers
        .keccak256(abiCoder.encode(['bytes', 'bytes', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes'], [
        userOperation.initCode,
        userOperation.callData,
        userOperation.callGasLimit,
        userOperation.verificationGasLimit,
        userOperation.preVerificationGas,
        userOperation.maxFeePerGas,
        userOperation.maxPriorityFeePerGas,
        userOperation.paymasterAndData
    ]))
        .substring(18)}${ethers_1.ethers.toBeHex(0, 8).substring(2)}`;
}
exports.getTargetEdgeCaseNonce = getTargetEdgeCaseNonce;
function getPaymasterSpoof() {
    const abiCoder = new ethers_1.ethers.AbiCoder();
    const spoofSig = abiCoder.encode(['address'], [deploy_1.AMBIRE_PAYMASTER_SIGNER]) + signatures_1.SPOOF_SIGTYPE;
    const simulationData = abiCoder.encode(['uint48', 'uint48', 'bytes'], [0, 0, spoofSig]);
    return ethers_1.ethers.hexlify(ethers_1.ethers.concat([deploy_1.AMBIRE_PAYMASTER, simulationData]));
}
exports.getPaymasterSpoof = getPaymasterSpoof;
function isErc4337Broadcast(network, accountState) {
    // write long to fix typescript issues
    const isEnabled = network && network.erc4337 ? network.erc4337.enabled : false;
    return isEnabled && accountState.isV2;
}
exports.isErc4337Broadcast = isErc4337Broadcast;
//# sourceMappingURL=userOperation.js.map