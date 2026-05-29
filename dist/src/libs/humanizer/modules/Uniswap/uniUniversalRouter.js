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
function parseV4Actions(actions, totalParams, accountAddr) {
    const parsedActions = parseCommands(actions);
    const parsed = [];
    if (!parsedActions)
        return [(0, utils_1.getAction)('Unknown Uniswap V4 action')];
    if (parsedActions.length !== totalParams.length)
        return [(0, utils_1.getAction)('Unknown Uniswap V4 action')];
    const zippedData = parsedActions.map((_, i) => ({
        action: parsedActions[i],
        param: totalParams[i]
    }));
    zippedData.forEach(({ action, param }) => {
        if (action === Commands_1.V4_ACTION_CODES.SETTLE) {
            const args = extractParams(Commands_1.V4_ACTION_DESCRIPTORS.SETTLE, param);
            parsed.push([(0, utils_1.getAction)('Send'), (0, utils_1.getToken)(args.currency, args.amount)]);
        }
        else if (action === Commands_1.V4_ACTION_CODES.SETTLE_ALL) {
            const args = extractParams(Commands_1.V4_ACTION_DESCRIPTORS.SETTLE_ALL, param);
            parsed.push([(0, utils_1.getAction)('Send'), (0, utils_1.getToken)(args.currency, args.maxAmount)]);
        }
        else if (action === Commands_1.V4_ACTION_CODES.SWAP_EXACT_IN) {
            const { swap } = extractParams(Commands_1.V4_ACTION_DESCRIPTORS.SWAP_EXACT_IN, param);
            const [tokenIn, path, amountIn, amountOut] = swap;
            const lastToken = path[path.length - 1][0];
            parsed.push([
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(tokenIn, 0n),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(lastToken, 0n)
            ]);
        }
        else if (action === Commands_1.V4_ACTION_CODES.SWAP_EXACT_OUT) {
            const { swap } = extractParams(Commands_1.V4_ACTION_DESCRIPTORS.SWAP_EXACT_OUT, param);
            const [tokenOut, path, amountOut, amountIn] = swap;
            const firstToken = path[0][0];
            parsed.push([
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(firstToken, 0n),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(tokenOut, 0n)
            ]);
        }
        else if (action === Commands_1.V4_ACTION_CODES.SWAP_EXACT_IN_SINGLE) {
            const { swap } = extractParams(Commands_1.V4_ACTION_DESCRIPTORS.SWAP_EXACT_IN_SINGLE, param);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [poolKey, zeroForOne, amountIn, amountOutMinimum, hookData] = swap;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [currency0, currency1, fee, tickSpacing, hooks] = poolKey;
            parsed.push([
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(currency0, 0n),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(currency1, 0n)
            ]);
        }
        else if (action === Commands_1.V4_ACTION_CODES.SWAP_EXACT_OUT_SINGLE) {
            const { swap } = extractParams(Commands_1.V4_ACTION_DESCRIPTORS.SWAP_EXACT_OUT_SINGLE, param);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [poolKey, zeroForOne, amountOut, amountInMaximum, hookData] = swap;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [currency0, currency1, fee, tickSpacing, hooks] = poolKey;
            parsed.push([
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(currency0, 0n),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(currency1, 0n)
            ]);
        }
        else if (action === Commands_1.V4_ACTION_CODES.TAKE) {
            const args = extractParams(Commands_1.V4_ACTION_DESCRIPTORS.TAKE, param);
            if (args.amount &&
                ['0x0000000000000000000000000000000000000002', accountAddr].includes(args.recipient))
                parsed.push([(0, utils_1.getAction)('Take'), (0, utils_1.getToken)(args.currency, args.amount)]);
        }
        else if (action === Commands_1.V4_ACTION_CODES.TAKE_ALL) {
            const args = extractParams(Commands_1.V4_ACTION_DESCRIPTORS.TAKE_ALL, param);
            parsed.push([(0, utils_1.getAction)('Take'), (0, utils_1.getToken)(args.currency, args.minAmount)]);
        }
        else {
            parsed.push([(0, utils_1.getAction)('Unknown uniswap V4 action')]);
        }
    });
    return (0, utils_2.uniReduce)(parsed);
}
const ifaceUniversalRouter = new ethers_1.Interface(abis_1.UniswapUniversalRouter);
exports.uniUniversalRouter = {
    [`${ifaceUniversalRouter.getFunction('execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)')?.selector}`]: (accountOp, call) => {
        if (!call.to)
            throw Error('Humanizer: should not be inside the uniswap module when !call.to');
        const [commands, inputs, deadline] = ifaceUniversalRouter.parseTransaction(call)?.args || [];
        const parsedCommands = parseCommands(commands);
        const parsed = [];
        parsedCommands
            ? parsedCommands.forEach((command, index) => {
                if (command === Commands_1.COMMANDS.V3_SWAP_EXACT_IN) {
                    const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_IN;
                    const params = extractParams(inputsDetails, inputs[index]);
                    const path = (0, utils_2.parsePath)(params.path);
                    if (path.length) {
                        parsed.push([
                            (0, utils_1.getAction)('Swap'),
                            (0, utils_1.getToken)(path[0], 0n),
                            (0, utils_1.getLabel)('for'),
                            (0, utils_1.getToken)(path[path.length - 1], 0n),
                            (0, utils_1.getDeadline)(deadline)
                        ]);
                    }
                }
                else if (command === Commands_1.COMMANDS.V3_SWAP_EXACT_OUT) {
                    const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_OUT;
                    const params = extractParams(inputsDetails, inputs[index]);
                    const path = (0, utils_2.parsePath)(params.path);
                    if (path.length) {
                        parsed.push([
                            (0, utils_1.getAction)('Swap'),
                            (0, utils_1.getToken)(path[path.length - 1], 0n),
                            (0, utils_1.getLabel)('for'),
                            (0, utils_1.getToken)(path[0], 0n),
                            (0, utils_1.getDeadline)(deadline)
                        ]);
                    }
                }
                else if (command === Commands_1.COMMANDS.SWEEP) {
                    const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.SWEEP;
                    const params = extractParams(inputsDetails, inputs[index]);
                    if (['0x0000000000000000000000000000000000000001', accountOp.accountAddr].includes(params.recipient))
                        parsed.push([(0, utils_1.getAction)('Take'), (0, utils_1.getToken)(params.token, params.amountMin)]);
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
                    try {
                        const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_IN;
                        const params = extractParams(inputsDetails, inputs[index]);
                        const path = params.path;
                        parsed.push([
                            (0, utils_1.getAction)('Swap'),
                            (0, utils_1.getToken)(path[0], 0n),
                            (0, utils_1.getLabel)('for'),
                            (0, utils_1.getToken)(path[path.length - 1], 0n),
                            (0, utils_1.getDeadline)(deadline)
                        ]);
                    }
                    catch (e) {
                        // alternative encoding, handled here
                        // https://www.codeslaw.app/contracts/base/0x6Df1c91424F79E40E33B1A48F0687B666bE71075?file=contracts%2Fmodules%2Funiswap%2Fv2%2FV2SwapRouter.sol&start=158&end=160
                        // https://www.codeslaw.app/contracts/base/0x6Df1c91424F79E40E33B1A48F0687B666bE71075?file=contracts%2Fmodules%2Funiswap%2Fv2%2FV2SwapRouter.sol&start=223&end=259
                        const params = extractParams([
                            { type: 'address', name: 'user' },
                            { type: 'uint256', name: 'amountIn' },
                            { type: 'uint256', name: 'amountOut' },
                            { type: 'bytes', name: 'path' },
                            { type: 'bool', name: 'isUserPayer' },
                            { type: 'bool', name: 'isUni' }
                        ], inputs[index]);
                        if ((params.path.length / (2 + 40)) % 1 === 0) {
                            parsed.push([
                                (0, utils_1.getAction)('Swap'),
                                (0, utils_1.getToken)(params.path.slice(0, 42), 0n),
                                (0, utils_1.getLabel)('for'),
                                (0, utils_1.getToken)('0x' + params.path.slice(-40), 0n)
                            ]);
                        }
                    }
                }
                else if (command === Commands_1.COMMANDS.V2_SWAP_EXACT_OUT) {
                    const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_OUT;
                    const params = extractParams(inputsDetails, inputs[index]);
                    const path = params.path;
                    parsed.push([
                        (0, utils_1.getAction)('Swap'),
                        (0, utils_1.getToken)(path[0], 0n),
                        (0, utils_1.getLabel)('for'),
                        (0, utils_1.getToken)(path[path.length - 1], 0n),
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
                            (0, utils_1.getToken)(ethers_1.ZeroAddress, 0n),
                            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient)
                        ]);
                }
                else if (command === Commands_1.COMMANDS.V4_SWAP) {
                    const { inputsDetails } = Commands_1.COMMANDS_DESCRIPTIONS.V4_SWAP;
                    const params = extractParams(inputsDetails, inputs[index]);
                    const v4NewHumanization = parseV4Actions(params.actions, params.params, accountOp.accountAddr);
                    parsed.push(v4NewHumanization);
                }
                else {
                    if (!call.to)
                        throw Error('Humanizer: should not be inside the uniswap module when !call.to');
                    parsed.push([
                        (0, utils_1.getAction)('Uniswap action'),
                        (0, utils_1.getLabel)('to'),
                        (0, utils_1.getAddressVisualization)(call.to)
                    ]);
                }
            })
            : parsed.push([(0, utils_1.getAction)('Uniswap action'), (0, utils_1.getLabel)('to'), (0, utils_1.getAddressVisualization)(call.to)]);
        return (0, utils_2.uniReduce)(parsed);
    }
};
//# sourceMappingURL=uniUniversalRouter.js.map