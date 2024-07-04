"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimate = void 0;
const ethers_1 = require("ethers");
const deployless_1 = require("../deployless/deployless");
const account_1 = require("../account/account");
const Estimation_json_1 = __importDefault(require("../../../contracts/compiled/Estimation.json"));
const AmbireAccount_json_1 = __importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireAccountFactory_json_1 = __importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
async function estimate(provider, network, account, op, nativeToCheck, feeTokens, opts, fromAddrHavingNative, blockFrom = '0x0000000000000000000000000000000000000001', blockTag = 'latest') {
    if (!account.creation) {
        if (op.calls.length !== 1) {
            throw new Error("EOA can't have more than one call!");
        }
        const call = op.calls[0];
        const nonce = await provider.getTransactionCount(account.addr);
        const [gasUsed, balance] = await Promise.all([
            provider.estimateGas({
                from: account.addr,
                to: call.to,
                value: call.value,
                data: call.data,
                nonce
            }),
            provider.getBalance(account.addr)
        ]);
        return {
            gasUsed,
            nonce,
            feePaymentOptions: [
                {
                    paidBy: account.addr,
                    availableAmount: balance
                }
            ]
        };
    }
    const deploylessEstimator = (0, deployless_1.fromDescriptor)(provider, Estimation_json_1.default, !network.rpcNoStateOverride);
    // @TODO - .env or passed as parameter?
    const relayerAddress = '0x942f9CE5D9a33a82F88D233AEb3292E680230348';
    const calculateAnomalies = opts?.calculateAnomalies && fromAddrHavingNative;
    const args = [
        account.addr,
        ...(0, account_1.getAccountDeployParams)(account),
        // @TODO can pass 0 here for the addr
        [
            account.addr,
            op.accountOpToExecuteBefore?.nonce || 0,
            op.accountOpToExecuteBefore?.calls || [],
            op.accountOpToExecuteBefore?.signature || '0x'
        ],
        [account.addr, op.nonce || 1, op.calls, '0x'],
        account.associatedKeys,
        feeTokens,
        relayerAddress,
        calculateAnomalies ? [fromAddrHavingNative].concat(nativeToCheck) : nativeToCheck
    ];
    // @TODO explain this
    const simulationGasPrice = 500000000n;
    const simulationGasLimit = 500000n;
    const gasPrice = `0x${Number(simulationGasPrice).toString(16)}`;
    const gasLimit = `0x${Number(simulationGasLimit).toString(16)}`;
    /* eslint-disable prefer-const */
    let [[deployment, accountOpToExecuteBefore, accountOp, nonce, feeTokenOutcomes, , nativeAssetBalances]] = await deploylessEstimator.call('estimate', args, {
        from: blockFrom,
        blockTag,
        gasPrice: calculateAnomalies ? gasPrice : undefined,
        gasLimit: calculateAnomalies ? gasLimit : undefined
    });
    /* eslint-enable prefer-const */
    let gasUsed = deployment.gasUsed + accountOpToExecuteBefore.gasUsed + accountOp.gasUsed;
    if (opts?.calculateRefund) {
        const IAmbireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
        const IAmbireAccountFactory = new ethers_1.Interface(AmbireAccountFactory_json_1.default.abi);
        const accountCalldata = op.accountOpToExecuteBefore
            ? IAmbireAccount.encodeFunctionData('executeMultiple', [
                [
                    [op.accountOpToExecuteBefore.calls, op.accountOpToExecuteBefore.signature],
                    [op.calls, op.signature]
                ]
            ])
            : IAmbireAccount.encodeFunctionData('execute', [op.calls, op.signature]);
        const factoryCalldata = IAmbireAccountFactory.encodeFunctionData('deployAndExecute', [
            account.creation.bytecode,
            account.creation.salt,
            [[account.addr, 0, accountCalldata]],
            op.signature
        ]);
        const estimatedGas = await provider.estimateGas({
            from: '0x0000000000000000000000000000000000000001',
            to: account.creation.factoryAddr,
            data: factoryCalldata
        });
        const estimatedRefund = gasUsed - estimatedGas;
        // As of EIP-3529, the max refund is 1/5th of the entire cost
        if (estimatedRefund <= gasUsed / 5n && estimatedRefund > 0n)
            gasUsed = estimatedGas;
    }
    let addedNative;
    if (calculateAnomalies) {
        const nativeFromBalance = await provider.getBalance(fromAddrHavingNative);
        // @TODO - Both balances are equal, but they shouldn't be as the contract balance should include the fee
        console.log({ nativeFromBalance, contractNativeFromBalance: nativeAssetBalances[0] });
        addedNative =
            nativeFromBalance - (nativeAssetBalances[0] - simulationGasPrice * simulationGasLimit);
        nativeAssetBalances = nativeAssetBalances.slice(1);
    }
    const feeTokenOptions = feeTokenOutcomes.map((token, key) => ({
        address: feeTokens[key],
        paidBy: account.addr,
        availableAmount: token.amount,
        gasUsed: token.gasUsed
    }));
    const nativeTokenOptions = nativeAssetBalances.map((balance, key) => ({
        paidBy: nativeToCheck[key],
        availableAmount: balance
    }));
    return {
        gasUsed,
        nonce,
        addedNative,
        feePaymentOptions: [...feeTokenOptions, ...nativeTokenOptions]
    };
}
exports.estimate = estimate;
//# sourceMappingURL=estimate.js.map