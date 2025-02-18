"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refund = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
async function refund(account, op, provider, gasUsed) {
    // WARNING: calculateRefund will 100% NOT work in all cases we have
    // So a warning not to assume this is working
    const IAmbireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
    const IAmbireFactory = new ethers_1.Interface(AmbireFactory_json_1.default.abi);
    const accountCalldata = op.accountOpToExecuteBefore
        ? IAmbireAccount.encodeFunctionData('executeMultiple', [
            [
                [op.accountOpToExecuteBefore.calls, op.accountOpToExecuteBefore.signature],
                [op.calls, op.signature]
            ]
        ])
        : IAmbireAccount.encodeFunctionData('execute', [op.calls, op.signature]);
    const factoryCalldata = IAmbireFactory.encodeFunctionData('deployAndExecute', [
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
        return estimatedGas;
    return gasUsed;
}
exports.refund = refund;
//# sourceMappingURL=refund.js.map