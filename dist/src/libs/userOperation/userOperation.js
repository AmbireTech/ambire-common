"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLogs = exports.ENTRY_POINT_AUTHORIZATION_REQUEST_ID = void 0;
exports.calculateCallDataCost = calculateCallDataCost;
exports.getPaymasterSpoof = getPaymasterSpoof;
exports.getSigForCalculations = getSigForCalculations;
exports.getActivatorCall = getActivatorCall;
exports.getCleanUserOp = getCleanUserOp;
exports.getOneTimeNonce = getOneTimeNonce;
exports.getRequestType = getRequestType;
exports.getUserOperation = getUserOperation;
exports.shouldIncludeActivatorCall = shouldIncludeActivatorCall;
exports.getPackedUserOp = getPackedUserOp;
exports.getUserOpHash = getUserOpHash;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const deploy_1 = require("../../consts/deploy");
const signatures_1 = require("../../consts/signatures");
const accountOp_1 = require("../accountOp/accountOp");
function calculateCallDataCost(callData) {
    if (callData === '0x')
        return 0n;
    const bytes = Buffer.from(callData.substring(2));
    const nonZeroBytes = BigInt(bytes.filter((b) => b).length);
    const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes);
    return zeroBytes * 4n + nonZeroBytes * 16n;
}
function getPaymasterSpoof() {
    const abiCoder = new ethers_1.AbiCoder();
    const spoofSig = abiCoder.encode(['address'], [deploy_1.AMBIRE_PAYMASTER_SIGNER]) + signatures_1.SPOOF_SIGTYPE;
    const simulationData = abiCoder.encode(['uint48', 'uint48', 'bytes'], [0, 0, spoofSig]);
    return (0, ethers_1.hexlify)((0, ethers_1.concat)([deploy_1.AMBIRE_PAYMASTER, simulationData]));
}
function getSigForCalculations() {
    return '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01';
}
// get the call to give privileges to the entry point
function getActivatorCall(addr) {
    const saAbi = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
    const givePermsToEntryPointData = saAbi.encodeFunctionData('setAddrPrivilege', [
        deploy_1.ERC_4337_ENTRYPOINT,
        deploy_1.ENTRY_POINT_MARKER
    ]);
    return {
        to: addr,
        value: 0n,
        data: givePermsToEntryPointData
    };
}
/**
 * When we use abi.encode or send the user operation to the bundler,
 * we need to strip it of the specific ambire-common properties that we use
 *
 * @param UserOperation userOp
 * @returns EntryPoint userOp
 */
function getCleanUserOp(userOp) {
    return [(({ requestType, activatorCall, bundler, ...o }) => o)(userOp)];
}
/**
 * Get the nonce we're expecting in validateUserOp
 * when we're going through the activation | recovery
 *
 * @param UserOperation userOperation
 * @returns hex string
 */
function getOneTimeNonce(userOperation) {
    if (!userOperation.paymaster ||
        !userOperation.paymasterVerificationGasLimit ||
        !userOperation.paymasterPostOpGasLimit ||
        !userOperation.paymasterData) {
        throw new Error('One time nonce could not be encoded because paymaster data is missing');
    }
    const abiCoder = new ethers_1.AbiCoder();
    return `0x${(0, ethers_1.keccak256)(abiCoder.encode(['bytes', 'bytes', 'bytes32', 'uint256', 'bytes32', 'bytes'], [
        userOperation.factory && userOperation.factoryData
            ? (0, ethers_1.concat)([userOperation.factory, userOperation.factoryData])
            : '0x',
        userOperation.callData,
        (0, ethers_1.concat)([
            (0, ethers_1.toBeHex)(userOperation.verificationGasLimit, 16),
            (0, ethers_1.toBeHex)(userOperation.callGasLimit, 16)
        ]),
        userOperation.preVerificationGas,
        (0, ethers_1.concat)([
            (0, ethers_1.toBeHex)(userOperation.maxPriorityFeePerGas, 16),
            (0, ethers_1.toBeHex)(userOperation.maxFeePerGas, 16)
        ]),
        (0, ethers_1.concat)([
            userOperation.paymaster,
            (0, ethers_1.toBeHex)(userOperation.paymasterVerificationGasLimit, 16),
            (0, ethers_1.toBeHex)(userOperation.paymasterPostOpGasLimit, 16),
            userOperation.paymasterData
        ])
    ])).substring(18)}${(0, ethers_1.toBeHex)(0, 8).substring(2)}`;
}
function getRequestType(accountState) {
    return accountState.isEOA ? '7702' : 'standard';
}
function getUserOperation(account, accountState, accountOp, bundler, entryPointSig, eip7702Auth) {
    const userOp = {
        sender: accountOp.accountAddr,
        nonce: (0, ethers_1.toBeHex)(accountState.erc4337Nonce),
        callData: '0x',
        callGasLimit: (0, ethers_1.toBeHex)(0),
        verificationGasLimit: (0, ethers_1.toBeHex)(0),
        preVerificationGas: (0, ethers_1.toBeHex)(0),
        maxFeePerGas: (0, ethers_1.toBeHex)(1),
        maxPriorityFeePerGas: (0, ethers_1.toBeHex)(1),
        signature: '0x',
        requestType: getRequestType(accountState),
        bundler
    };
    // if the account is not deployed, prepare the deploy in the initCode
    if (entryPointSig) {
        if (!account.creation)
            throw new Error('Account creation properties are missing');
        const factoryInterface = new ethers_1.Interface(AmbireFactory_json_1.default.abi);
        userOp.factory = account.creation.factoryAddr;
        userOp.factoryData = factoryInterface.encodeFunctionData('deployAndExecute', [
            account.creation.bytecode,
            account.creation.salt,
            [(0, accountOp_1.callToTuple)(getActivatorCall(accountOp.accountAddr))],
            entryPointSig
        ]);
    }
    // if the request type is activator, add the activator call
    if (userOp.requestType === 'activator')
        userOp.activatorCall = getActivatorCall(accountOp.accountAddr);
    userOp.eip7702Auth = eip7702Auth;
    return userOp;
}
// for special cases where we broadcast a 4337 operation with an EOA,
// add the activator call so the use has the entry point attached
function shouldIncludeActivatorCall(network, account, accountState, is4337Broadcast = true) {
    return (account.creation &&
        account.creation.factoryAddr === deploy_1.AMBIRE_ACCOUNT_FACTORY &&
        accountState.isV2 &&
        !accountState.isEOA &&
        network.erc4337.enabled &&
        !accountState.isErc4337Enabled &&
        (accountState.isDeployed || !is4337Broadcast));
}
exports.ENTRY_POINT_AUTHORIZATION_REQUEST_ID = 'ENTRY_POINT_AUTHORIZATION_REQUEST_ID';
function getPackedUserOp(userOp) {
    const initCode = userOp.factory ? (0, ethers_1.concat)([userOp.factory, userOp.factoryData]) : '0x';
    const accountGasLimits = (0, ethers_1.concat)([
        (0, ethers_1.toBeHex)(userOp.verificationGasLimit.toString(), 16),
        (0, ethers_1.toBeHex)(userOp.callGasLimit.toString(), 16)
    ]);
    const gasFees = (0, ethers_1.concat)([
        (0, ethers_1.toBeHex)(userOp.maxPriorityFeePerGas.toString(), 16),
        (0, ethers_1.toBeHex)(userOp.maxFeePerGas.toString(), 16)
    ]);
    const paymasterAndData = userOp.paymaster
        ? (0, ethers_1.concat)([
            userOp.paymaster,
            (0, ethers_1.toBeHex)(userOp.paymasterVerificationGasLimit.toString(), 16),
            (0, ethers_1.toBeHex)(userOp.paymasterPostOpGasLimit.toString(), 16),
            userOp.paymasterData
        ])
        : '0x';
    return {
        sender: userOp.sender,
        nonce: BigInt(userOp.nonce),
        initCode: initCode,
        callData: userOp.callData,
        accountGasLimits: accountGasLimits,
        preVerificationGas: BigInt(userOp.preVerificationGas),
        gasFees: gasFees,
        paymasterAndData: paymasterAndData
    };
}
function getUserOpHash(userOp, chainId) {
    const abiCoder = new ethers_1.AbiCoder();
    const packedUserOp = getPackedUserOp(userOp);
    const hashInitCode = (0, ethers_1.keccak256)(packedUserOp.initCode);
    const hashCallData = (0, ethers_1.keccak256)(packedUserOp.callData);
    const hashPaymasterAndData = (0, ethers_1.keccak256)(packedUserOp.paymasterAndData);
    const packed = abiCoder.encode(['address', 'uint256', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'bytes32'], [
        userOp.sender,
        userOp.nonce,
        hashInitCode,
        hashCallData,
        packedUserOp.accountGasLimits,
        userOp.preVerificationGas,
        packedUserOp.gasFees,
        hashPaymasterAndData
    ]);
    const packedHash = (0, ethers_1.keccak256)(packed);
    return (0, ethers_1.keccak256)(abiCoder.encode(['bytes32', 'address', 'uint256'], [packedHash, deploy_1.ERC_4337_ENTRYPOINT, chainId]));
}
// try to parse the UserOperationEvent to understand whether
// the user op is a success or a failure
const parseLogs = (logs, userOpHash, userOpsLength // benzina only
) => {
    if (userOpHash === '' && userOpsLength !== 1)
        return null;
    let userOpLog = null;
    logs.forEach((log) => {
        try {
            if (log.topics.length === 4 &&
                (log.topics[1].toLowerCase() === userOpHash.toLowerCase() || userOpsLength === 1)) {
                // decode data for UserOperationEvent:
                // 'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
                const coder = new ethers_1.AbiCoder();
                userOpLog = coder.decode(['uint256', 'bool', 'uint256', 'uint256'], log.data);
            }
        }
        catch (e) {
            /* silence is bitcoin */
        }
    });
    if (!userOpLog)
        return null;
    return {
        nonce: userOpLog[0],
        success: userOpLog[1]
    };
};
exports.parseLogs = parseLogs;
//# sourceMappingURL=userOperation.js.map