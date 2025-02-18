"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMintVestingRequest = exports.buildClaimWalletRequest = exports.buildTransferUserRequest = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const WALLETSupplyController_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/WALLETSupplyController.json"));
const WETH_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/WETH.json"));
const addresses_1 = require("../../consts/addresses");
const networks_1 = require("../../consts/networks");
const amount_1 = require("./amount");
const ERC20 = new ethers_1.Interface(IERC20_json_1.default.abi);
const supplyControllerInterface = new ethers_1.Interface(WALLETSupplyController_json_1.default);
function buildMintVestingRequest({ selectedAccount, selectedToken, addrVestingData }) {
    const txn = {
        kind: 'calls',
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
        ]
    };
    return {
        id: new Date().getTime(),
        action: txn,
        meta: {
            isSignAction: true,
            networkId: selectedToken.networkId,
            accountAddr: selectedAccount
        }
    };
}
exports.buildMintVestingRequest = buildMintVestingRequest;
function buildClaimWalletRequest({ selectedAccount, selectedToken, claimableRewardsData }) {
    const txn = {
        kind: 'calls',
        calls: [
            {
                to: addresses_1.SUPPLY_CONTROLLER_ADDR,
                value: BigInt(0),
                data: supplyControllerInterface.encodeFunctionData('claimWithRootUpdate', [
                    claimableRewardsData?.totalClaimable,
                    claimableRewardsData?.proof,
                    0,
                    addresses_1.WALLET_STAKING_ADDR,
                    claimableRewardsData?.root,
                    claimableRewardsData?.signedRoot
                ])
            }
        ]
    };
    return {
        id: new Date().getTime(),
        action: txn,
        meta: {
            isSignAction: true,
            networkId: selectedToken.networkId,
            accountAddr: selectedAccount
        }
    };
}
exports.buildClaimWalletRequest = buildClaimWalletRequest;
function buildTransferUserRequest({ amount, selectedToken, selectedAccount, recipientAddress: _recipientAddress }) {
    if (!selectedToken || !selectedAccount || !_recipientAddress)
        return null;
    // if the request is a top up, the recipient is the relayer
    const recipientAddress = _recipientAddress?.toLowerCase();
    const sanitizedAmount = (0, amount_1.getSanitizedAmount)(amount, selectedToken.decimals);
    const bigNumberHexAmount = `0x${(0, ethers_1.parseUnits)(sanitizedAmount, Number(selectedToken.decimals)).toString(16)}`;
    // if the top up is a native one, we should wrap the native before sending it
    // as otherwise a Transfer event is not emitted and the top up will not be
    // recorded
    const isNativeTopUp = Number(selectedToken.address) === 0 &&
        recipientAddress.toLowerCase() === addresses_1.FEE_COLLECTOR.toLowerCase();
    if (isNativeTopUp) {
        // if not predefined network, we cannot make a native top up
        const network = networks_1.networks.find((net) => net.id === selectedToken.networkId);
        if (!network)
            return null;
        // if a wrapped addr is not specified, we cannot make a native top up
        const wrappedAddr = network.wrappedAddr;
        if (!wrappedAddr)
            return null;
        const wrapped = new ethers_1.Interface(WETH_json_1.default);
        const deposit = wrapped.encodeFunctionData('deposit');
        const calls = {
            kind: 'calls',
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
            ]
        };
        return {
            id: new Date().getTime(),
            action: calls,
            meta: {
                isSignAction: true,
                networkId: selectedToken.networkId,
                accountAddr: selectedAccount
            }
        };
    }
    const txn = {
        kind: 'calls',
        calls: [
            {
                to: selectedToken.address,
                value: BigInt(0),
                data: ERC20.encodeFunctionData('transfer', [recipientAddress, bigNumberHexAmount])
            }
        ]
    };
    if (Number(selectedToken.address) === 0) {
        txn.calls = [
            {
                to: recipientAddress,
                value: BigInt(bigNumberHexAmount),
                data: '0x'
            }
        ];
    }
    return {
        id: new Date().getTime(),
        action: txn,
        meta: {
            isSignAction: true,
            networkId: selectedToken.networkId,
            accountAddr: selectedAccount
        }
    };
}
exports.buildTransferUserRequest = buildTransferUserRequest;
//# sourceMappingURL=userRequest.js.map