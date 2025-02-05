"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uniUniversalRouter = void 0;
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
const utils_1 = require("../../utils");
const Commands_1 = require("./Commands");
const utils_2 = require("./utils");
const coder = new ethers_1.AbiCoder();
const extractParams = (inputsDetails, input) => {
    const types = inputsDetails.map((i) => i.type);
    const decodedInput = coder.decode(types, input);
    const params = {};
    inputsDetails.forEach((item, index) => {
        params[item.name] = decodedInput[index];
    });
    return params;
};
// this function splits uniswap commands from single hex string to multiple hex strings
// '0x1234' => ['0x12', '0x34']
function parseCommands(commands) {
    // all commands are 1 byte = 2 hex chars
    if (commands.length % 2)
        return null;
    if (!/^0x[0-9A-Fa-f]+$/.test(commands))
        return null;
    const res = [];
    // iterate over pairs of chars
    for (let i = 2; i < commands.length; i += 2) {
        res.push(`0x${commands.slice(i, i + 2)}`);
    }
    return res;
}
const uniUniversalRouter = () => {
    const ifaceUniversalRouter = new ethers_1.Interface(abis_1.UniswapUniversalRouter);
    return {
        [`${ifaceUniversalRouter.getFunction('execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)')?.selector}`]: (accountOp, call) => {
            const [commands, inputs, deadline] = ifaceUniversalRouter.parseTransaction(call)?.args || [];
            const parsedCommands = parseCommands(commands);
            const parsed = [];
            parsedCommands
                ? parsedCommands.forEach((command, index) => {
                    if (command === Commands_1.COMMANDS.V3_SWAP_EXACT_IN) {
                        const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_IN;
                        const params = extractParams(inputsDetails, inputs[index]);
                        const path = (0, utils_2.parsePath)(params.path);
                        parsed.push([
                            (0, utils_1.getAction)('Swap'),
                            (0, utils_1.getToken)(path[0], params.amountIn),
                            (0, utils_1.getLabel)('for at least'),
                            (0, utils_1.getToken)(path[path.length - 1], params.amountOutMin),
                            (0, utils_1.getDeadline)(deadline)
                        ]);
                    }
                    else if (command === Commands_1.COMMANDS.V3_SWAP_EXACT_OUT) {
                        const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_OUT;
                        const params = extractParams(inputsDetails, inputs[index]);
                        const path = (0, utils_2.parsePath)(params.path);
                        parsed.push([
                            (0, utils_1.getAction)('Swap up to'),
                            (0, utils_1.getToken)(path[path.length - 1], params.amountInMax),
                            (0, utils_1.getLabel)('for'),
                            (0, utils_1.getToken)(path[0], params.amountOut),
                            (0, utils_1.getDeadline)(deadline)
                        ]);
                    }
                    else if (command === Commands_1.COMMANDS.SWEEP) {
                        const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.SWEEP;
                        const params = extractParams(inputsDetails, inputs[index]);
                        if (['0x0000000000000000000000000000000000000001', accountOp.accountAddr].includes(params.recipient))
                            parsed.push([
                                (0, utils_1.getAction)('Take'),
                                (0, utils_1.getLabel)('at least'),
                                (0, utils_1.getToken)(params.token, params.amountMin)
                            ]);
                        else
                            parsed.push([
                                (0, utils_1.getAction)('Send'),
                                (0, utils_1.getToken)(params.token, params.amountMin),
                                (0, utils_1.getLabel)('to'),
                                (0, utils_1.getAddressVisualization)(params.recipient)
                            ]);
                    }
                    else if (command === Commands_1.COMMANDS.PAY_PORTION) {
                        // @NOTE: this is used for paying fee although its already calculated in the humanized response
                        // @NOTE: no need to be displayed but we can add warning id the fee is too high?
                        // const { inputsDetails } = COMMANDS_DESCRIPTIONS.PAY_PORTION
                        // const params = extractParams(inputsDetails, inputs[index])
                        // parsed.push({
                        //   ...call,
                        //   fullVisualization: [
                        //     getAction('Pay fee'),
                        //     getLabel('of'),
                        //     // bips are fee. can be 0 or within 10-9999 and converts to %
                        //     // https://docs.uniswap.org/contracts/v2/guides/interface-integration/custom-interface-linking#constraints
                        //     getLabel(`${Number(params.bips) / 100}%`)
                        //   ]
                        // })
                    }
                    else if (command === Commands_1.COMMANDS.TRANSFER) {
                        // when we swap with exact out the ui displays amount X for out token
                        // the actual swap is X + small fee
                        // and this is the small fee that is to be sent to the fee collector of uniswap
                        // at later stage of the humanizer pipeline if swap with the same token is present exactly before this transfer
                        // we will subtract the amount from the swap and remove this call from the visualization
                        const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.TRANSFER;
                        const params = extractParams(inputsDetails, inputs[index]);
                        parsed.push([
                            (0, utils_1.getAction)('Send'),
                            (0, utils_1.getToken)(params.token, params.value),
                            (0, utils_1.getLabel)('to'),
                            (0, utils_1.getAddressVisualization)(params.recipient)
                        ]);
                    }
                    else if (command === Commands_1.COMMANDS.V2_SWAP_EXACT_IN) {
                        const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_IN;
                        const params = extractParams(inputsDetails, inputs[index]);
                        const path = params.path;
                        parsed.push([
                            (0, utils_1.getAction)('Swap'),
                            (0, utils_1.getToken)(path[0], params.amountIn),
                            (0, utils_1.getLabel)('for at least'),
                            (0, utils_1.getToken)(path[path.length - 1], params.amountOutMin),
                            (0, utils_1.getDeadline)(deadline)
                        ]);
                    }
                    else if (command === Commands_1.COMMANDS.V2_SWAP_EXACT_OUT) {
                        const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_OUT;
                        const params = extractParams(inputsDetails, inputs[index]);
                        const path = params.path;
                        parsed.push([
                            (0, utils_1.getAction)('Swap up to'),
                            (0, utils_1.getToken)(path[0], params.amountInMax),
                            (0, utils_1.getLabel)('for'),
                            (0, utils_1.getToken)(path[path.length - 1], params.amountOut),
                            (0, utils_1.getDeadline)(deadline)
                        ]);
                    }
                    else if (command === Commands_1.COMMANDS.PERMIT2_PERMIT) {
                        const { permit: { details: { token, amount /* expiration, nonce */ }, spender
                        // sigDeadline
                         }
                        // signature
                         } = extractParams(Commands_1.COMMANDS_DESCRIPTIONS.PERMIT2_PERMIT.inputsDetails, inputs[index]);
                        parsed.push([
                            (0, utils_1.getAction)('Grant approval'),
                            (0, utils_1.getLabel)('for'),
                            (0, utils_1.getToken)(token, amount),
                            (0, utils_1.getLabel)('to'),
                            (0, utils_1.getAddressVisualization)(spender)
                        ]);
                    }
                    else if (command === Commands_1.COMMANDS.WRAP_ETH) {
                        const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.WRAP_ETH;
                        const params = extractParams(inputsDetails, inputs[index]);
                        params.amountMin && parsed.push((0, utils_1.getWrapping)(ethers_1.ZeroAddress, params.amountMin));
                    }
                    else if (command === Commands_1.COMMANDS.UNWRAP_WETH) {
                        const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.UNWRAP_WETH;
                        const params = extractParams(inputsDetails, inputs[index]);
                        params.amountMin &&
                            parsed.push([
                                (0, utils_1.getAction)('Unwrap'),
                                (0, utils_1.getToken)(ethers_1.ZeroAddress, params.amountMin),
                                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient)
                            ]);
                    }
                    else
                        parsed.push((0, utils_1.getUnknownVisualization)('Uni V3', call));
                })
                : parsed.push((0, utils_1.getUnknownVisualization)('Uniswap V3', call));
            return (0, utils_2.uniReduce)(parsed);
        }
    };
};
exports.uniUniversalRouter = uniUniversalRouter;
//# sourceMappingURL=uniUniversalRouter.js.map