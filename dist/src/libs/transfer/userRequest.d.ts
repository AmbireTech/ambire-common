import { CallsUserRequest } from '../../interfaces/userRequest';
import { PaymasterService } from '../erc7677/types';
import { AddrVestingData, ClaimableRewardsData, TokenResult } from '../portfolio';
interface BuildUserRequestParams {
    amount: string;
    selectedToken: TokenResult;
    selectedAccount: string;
    recipientAddress: string;
    paymasterService?: PaymasterService;
    windowId?: number;
    amountInFiat?: bigint;
}
declare function getMintVestingRequestParams({ selectedAccount, selectedToken, addrVestingData }: {
    selectedAccount: string;
    selectedToken: TokenResult;
    addrVestingData: AddrVestingData;
}): {
    calls: CallsUserRequest['signAccountOp']['accountOp']['calls'];
    meta: CallsUserRequest['meta'];
};
declare function getClaimWalletRequestParams({ selectedAccount, selectedToken, claimableRewardsData }: {
    selectedAccount: string;
    selectedToken: TokenResult;
    claimableRewardsData: ClaimableRewardsData;
}): {
    calls: CallsUserRequest['signAccountOp']['accountOp']['calls'];
    meta: CallsUserRequest['meta'];
};
declare function getTransferRequestParams({ amount, amountInFiat, selectedToken, selectedAccount, recipientAddress: _recipientAddress, paymasterService }: BuildUserRequestParams): {
    calls: CallsUserRequest['signAccountOp']['accountOp']['calls'];
    meta: CallsUserRequest['meta'];
} | null;
declare function getIntentRequestParams({ selectedToken, selectedAccount, recipientAddress, paymasterService, transactions }: {
    selectedToken: TokenResult;
    selectedAccount: string;
    recipientAddress: string;
    paymasterService?: PaymasterService;
    transactions: {
        from: string;
        to: string;
        value?: string;
        data: string;
    }[];
}): {
    calls: CallsUserRequest['signAccountOp']['accountOp']['calls'];
    meta: CallsUserRequest['meta'];
} | null;
export { getClaimWalletRequestParams, getMintVestingRequestParams, getTransferRequestParams, getIntentRequestParams };
//# sourceMappingURL=userRequest.d.ts.map