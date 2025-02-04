import { Interface, parseUnits } from 'ethers';
import IERC20 from '../../../contracts/compiled/IERC20.json';
import WALLETSupplyControllerABI from '../../../contracts/compiled/WALLETSupplyController.json';
import WETH from '../../../contracts/compiled/WETH.json';
import { FEE_COLLECTOR, SUPPLY_CONTROLLER_ADDR, WALLET_STAKING_ADDR } from '../../consts/addresses';
import { networks } from '../../consts/networks';
import { getSanitizedAmount } from './amount';
const ERC20 = new Interface(IERC20.abi);
const supplyControllerInterface = new Interface(WALLETSupplyControllerABI);
function buildMintVestingRequest({ selectedAccount, selectedToken, addrVestingData }) {
    const txn = {
        kind: 'calls',
        calls: [
            {
                to: SUPPLY_CONTROLLER_ADDR,
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
function buildClaimWalletRequest({ selectedAccount, selectedToken, claimableRewardsData }) {
    const txn = {
        kind: 'calls',
        calls: [
            {
                to: SUPPLY_CONTROLLER_ADDR,
                value: BigInt(0),
                data: supplyControllerInterface.encodeFunctionData('claimWithRootUpdate', [
                    claimableRewardsData?.totalClaimable,
                    claimableRewardsData?.proof,
                    0,
                    WALLET_STAKING_ADDR,
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
function buildTransferUserRequest({ amount, selectedToken, selectedAccount, recipientAddress: _recipientAddress }) {
    if (!selectedToken || !selectedAccount || !_recipientAddress)
        return null;
    // if the request is a top up, the recipient is the relayer
    const recipientAddress = _recipientAddress?.toLowerCase();
    const sanitizedAmount = getSanitizedAmount(amount, selectedToken.decimals);
    const bigNumberHexAmount = `0x${parseUnits(sanitizedAmount, Number(selectedToken.decimals)).toString(16)}`;
    // if the top up is a native one, we should wrap the native before sending it
    // as otherwise a Transfer event is not emitted and the top up will not be
    // recorded
    const isNativeTopUp = Number(selectedToken.address) === 0 &&
        recipientAddress.toLowerCase() === FEE_COLLECTOR.toLowerCase();
    if (isNativeTopUp) {
        // if not predefined network, we cannot make a native top up
        const network = networks.find((net) => net.id === selectedToken.networkId);
        if (!network)
            return null;
        // if a wrapped addr is not specified, we cannot make a native top up
        const wrappedAddr = network.wrappedAddr;
        if (!wrappedAddr)
            return null;
        const wrapped = new Interface(WETH);
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
export { buildTransferUserRequest, buildClaimWalletRequest, buildMintVestingRequest };
//# sourceMappingURL=userRequest.js.map