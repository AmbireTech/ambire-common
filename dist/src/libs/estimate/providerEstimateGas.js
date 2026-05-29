import { Interface, toBeHex, toQuantity, ZeroAddress } from 'ethers';
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json';
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy';
import { getPendingBlockTagIfSupported } from '../../utils/getBlockTag';
import { isSmartAccount } from '../account/account';
import { getSignableCalls } from '../accountOp/accountOp';
import { getHumanReadableEstimationError } from '../errorHumanizer';
export function getEstimateGasProps(op, account, accountState) {
    if (accountState.isSmarterEoa) {
        const saAbi = new Interface(AmbireAccount.abi);
        return {
            from: account.addr,
            to: account.addr,
            value: '0x00',
            data: saAbi.encodeFunctionData('executeBySender', [getSignableCalls(op)]),
            useStateOverride: false
        };
    }
    // normal EOA: a single call
    const call = op.calls[0];
    return {
        from: account.addr,
        to: call.to,
        value: toBeHex(call.value),
        data: call.data,
        useStateOverride: false
    };
}
export async function providerEstimateGas(account, op, provider, accountState, network, feeTokens) {
    // we don't do estimateGas() for smart accounts
    if (isSmartAccount(account))
        return null;
    const feePaymentOptions = [
        {
            paidBy: account.addr,
            availableAmount: accountState.balance,
            addedNative: 0n,
            token: feeTokens.find((token) => token.address === ZeroAddress && !token.flags.onGasTank),
            gasUsed: 0n
        }
    ];
    const properties = getEstimateGasProps(op, account, accountState);
    const txnParams = {
        from: properties.from,
        to: properties.to,
        value: toQuantity(properties.value),
        data: properties.data,
        nonce: toQuantity(accountState.eoaNonce)
    };
    const blockTag = getPendingBlockTagIfSupported(network);
    const stateOverride = {
        [DEPLOYLESS_SIMULATION_FROM]: {
            balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        }
    };
    const params = properties.useStateOverride && !network.rpcNoStateOverride
        ? [txnParams, blockTag, stateOverride]
        : [txnParams, blockTag];
    const gasUsed = await provider
        .send('eth_estimateGas', params)
        .catch(getHumanReadableEstimationError);
    if (gasUsed instanceof Error)
        return gasUsed;
    return {
        gasUsed: BigInt(gasUsed),
        feePaymentOptions
    };
}
//# sourceMappingURL=providerEstimateGas.js.map