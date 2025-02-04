/* eslint-disable no-continue */
import { ZeroAddress } from 'ethers';
import { getLabel, getRecipientText } from '../../utils';
export function parsePath(pathBytes) {
    // some decodePacked fun
    // can we do this with Ethers AbiCoder? probably not
    const path = [];
    // address, uint24
    for (let i = 2; i < pathBytes.length; i += 46) {
        path.push(`0x${pathBytes.substr(i, 40)}`);
    }
    return path;
}
export const getUniRecipientText = (accAddr, recAddr) => ['0x0000000000000000000000000000000000000001', ZeroAddress].includes(recAddr)
    ? []
    : getRecipientText(accAddr, recAddr);
export const joinWithAndLabel = (humanizations) => {
    return humanizations.reduce((acc, arr) => [...acc, ...arr, getLabel('and')], []).slice(0, -1);
};
const isSwap = (call) => call &&
    call.length >= 4 &&
    call[0].content?.includes('Swap') &&
    call[1].type === 'token' &&
    call[3].type === 'token';
const isTake = (call) => call &&
    call.length === 3 &&
    call[0].content?.includes('Take') &&
    call[1].content === 'at least' &&
    call[2].type === 'token';
const isWrap = (call) => call && call.length >= 2 && call[0].content?.includes('Wrap') && call[1].type === 'token';
const isUnwrap = (call) => call && call.length >= 2 && call[0].content?.includes('Unwrap') && call[1].type === 'token';
const isSend = (call) => call &&
    call.length >= 4 &&
    call[0].content?.includes('Send') &&
    call[1].type === 'token' &&
    call[2]?.content?.includes('to') &&
    call[3].type === 'address';
export const uniReduce = (_calls) => {
    const calls = _calls;
    const originalCallsLength = calls.length;
    for (let i = 0; i < calls.length; i++) {
        for (let j = 0; j < calls.length; j++) {
            // looks for wraps before the swap
            if (j < i &&
                calls[i] &&
                calls[j] &&
                isSwap(calls[i]) &&
                isWrap(calls[j]) &&
                calls[j][1].value === calls[i][1].value) {
                calls[i][1].address = ZeroAddress;
                calls.splice(j, 1);
            }
            // looks for unwrap after the swap
            if (i < j &&
                calls[i] &&
                calls[j] &&
                isSwap(calls[i]) &&
                isUnwrap(calls[j]) &&
                calls[j][1].value === calls[i][3].value) {
                calls[i][3].address = ZeroAddress;
                calls.splice(j, 1);
            }
            // looks for swaps to merge
            if (i !== j &&
                calls[i] &&
                calls[j] &&
                isSwap(calls[i]) &&
                isSwap(calls[j]) &&
                calls[i][1].address === calls[j][1].address &&
                calls[i][3].address === calls[j][3].address) {
                calls[i][1].value = calls[i][1].value + calls[j][1].value;
                calls[i][3].value = calls[i][3].value + calls[j][3].value;
                calls.splice(j, 1);
            }
            // looks for fee payment to subtract
            if (i !== j &&
                calls[i] &&
                calls[j] &&
                isSend(calls[j]) &&
                isSwap(calls[i]) &&
                calls[i][3].value / 400n >= calls[j][1].value) {
                calls[i][3].value = calls[i][3].value - calls[j][1].value;
                calls.splice(j, 1);
            }
            // looks for take (sweep) action to infer the swap minimum by
            if (i !== j &&
                calls[i] &&
                calls[j] &&
                isSwap(calls[i]) &&
                isTake(calls[j]) &&
                calls[i][3].address === calls[j][2].address) {
                calls[i][3].value =
                    calls[i][3].value > calls[j][2].value ? calls[i][3].value : calls[j][2].value;
                calls.splice(j, 1);
            }
        }
    }
    return originalCallsLength === calls.length ? joinWithAndLabel(calls) : uniReduce(calls);
};
//# sourceMappingURL=utils.js.map