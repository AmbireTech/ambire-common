"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClaimWalletRequestParams = getClaimWalletRequestParams;
exports.getMintVestingRequestParams = getMintVestingRequestParams;
exports.getTransferRequestParams = getTransferRequestParams;
exports.getIntentRequestParams = getIntentRequestParams;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const uuid_1 = require("uuid");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const WALLETSupplyController_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/WALLETSupplyController.json"));
const WETH_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/WETH.json"));
const addresses_1 = require("../../consts/addresses");
const networks_1 = require("../../consts/networks");
const amount_1 = require("./amount");
const ERC20 = new ethers_1.Interface(IERC20_json_1.default.abi);
const supplyControllerInterface = new ethers_1.Interface(WALLETSupplyController_json_1.default);
function getMintVestingRequestParams({ selectedAccount, selectedToken, addrVestingData }) {
    return {
        calls: [
            {
                to: addresses_1.SUPPLY_CONTROLLER_ADDR,
                value: BigInt(0),
                data: supplyControllerInterface.encodeFunctionData('mintVesting', [
                    addrVestingData?.addr,
                    addrVestingData?.end,
                    addrVestingData?.rate
                ])
            }
        ],
        meta: {
            chainId: selectedToken.chainId,
            accountAddr: selectedAccount
        }
    };
}
function getClaimWalletRequestParams({ selectedAccount, selectedToken, claimableRewardsData }) {
    return {
        calls: [
            {
                to: addresses_1.SUPPLY_CONTROLLER_ADDR,
                value: BigInt(0),
                data: supplyControllerInterface.encodeFunctionData('claimWithRootUpdate', [
                    claimableRewardsData?.totalClaimable,
                    claimableRewardsData?.proof,
                    0, // penalty bps, at the moment we run with 0; it's a safety feature to hardcode it
                    addresses_1.STK_WALLET, // staking pool addr
                    claimableRewardsData?.root,
                    claimableRewardsData?.signedRoot
                ])
            }
        ],
        meta: {
            chainId: selectedToken.chainId,
            accountAddr: selectedAccount
        }
    };
}
function getTransferRequestParams({ amount, amountInFiat, selectedToken, selectedAccount, recipientAddress: _recipientAddress, paymasterService }) {
    if (!selectedToken || !selectedAccount || !_recipientAddress)
        return null;
    // if the request is a top up, the recipient is the relayer
    const recipientAddress = _recipientAddress?.toLowerCase();
    const isTopUp = recipientAddress.toLowerCase() === addresses_1.FEE_COLLECTOR.toLowerCase();
    const sanitizedAmount = (0, amount_1.getSanitizedAmount)(amount, selectedToken.decimals);
    const bigNumberHexAmount = `0x${(0, ethers_1.parseUnits)(sanitizedAmount, Number(selectedToken.decimals)).toString(16)}`;
    // if the top up is a native one, we should wrap the native before sending it
    // as otherwise a Transfer event is not emitted and the top up will not be
    // recorded
    const isNativeTopUp = Number(selectedToken.address) === 0 && isTopUp;
    if (isNativeTopUp) {
        // if not predefined network, we cannot make a native top up
        const network = networks_1.networks.find((n) => n.chainId === selectedToken.chainId);
        if (!network)
            return null;
        // if a wrapped addr is not specified, we cannot make a native top up
        const wrappedAddr = network.wrappedAddr;
        if (!wrappedAddr)
            return null;
        const wrapped = new ethers_1.Interface(WETH_json_1.default);
        const deposit = wrapped.encodeFunctionData('deposit');
        return {
            calls: [
                {
                    to: wrappedAddr,
                    value: BigInt(bigNumberHexAmount),
                    data: deposit
                },
                {
                    to: wrappedAddr,
                    value: BigInt(0),
                    data: ERC20.encodeFunctionData('transfer', [recipientAddress, bigNumberHexAmount])
                }
            ],
            meta: {
                chainId: selectedToken.chainId,
                accountAddr: selectedAccount,
                paymasterService,
                topUpAmount: isTopUp && amountInFiat ? amountInFiat : undefined
            }
        };
    }
    let calls = [
        {
            to: selectedToken.address,
            value: BigInt(0),
            data: ERC20.encodeFunctionData('transfer', [recipientAddress, bigNumberHexAmount])
        }
    ];
    if (Number(selectedToken.address) === 0) {
        calls = [
            {
                to: recipientAddress,
                value: BigInt(bigNumberHexAmount),
                data: '0x'
            }
        ];
    }
    return {
        calls,
        meta: {
            chainId: selectedToken.chainId,
            accountAddr: selectedAccount,
            paymasterService,
            topUpAmount: isTopUp && amountInFiat ? amountInFiat : undefined
        }
    };
}
function getIntentRequestParams({ selectedToken, selectedAccount, recipientAddress, paymasterService, transactions }) {
    if (!selectedToken || !selectedAccount || !recipientAddress)
        return null;
    const id = (0, uuid_1.v4)();
    return {
        calls: transactions.map((transaction, index) => ({
            id: `${id}-${index}`,
            to: transaction.to,
            value: BigInt(transaction.value || '0'),
            data: transaction.data
        })),
        meta: {
            chainId: selectedToken.chainId,
            accountAddr: selectedAccount,
            paymasterService,
            isSwapAndBridgeCall: true,
            activeRouteId: id
        }
    };
}
//# sourceMappingURL=userRequest.js.map