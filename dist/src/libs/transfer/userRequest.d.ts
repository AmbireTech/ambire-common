import { SignUserRequest } from '../../interfaces/userRequest';
import { AddrVestingData, ClaimableRewardsData, TokenResult } from '../portfolio';
interface BuildUserRequestParams {
    amount: string;
    selectedToken: TokenResult;
    selectedAccount: string;
    recipientAddress: string;
}
declare function buildMintVestingRequest({ selectedAccount, selectedToken, addrVestingData }: {
    selectedAccount: string;
    selectedToken: TokenResult;
    addrVestingData: AddrVestingData;
}): SignUserRequest;
declare function buildClaimWalletRequest({ selectedAccount, selectedToken, claimableRewardsData }: {
    selectedAccount: string;
    selectedToken: TokenResult;
    claimableRewardsData: ClaimableRewardsData;
}): SignUserRequest;
declare function buildTransferUserRequest({ amount, selectedToken, selectedAccount, recipientAddress: _recipientAddress }: BuildUserRequestParams): SignUserRequest | null;
export { buildTransferUserRequest, buildClaimWalletRequest, buildMintVestingRequest };
//# sourceMappingURL=userRequest.d.ts.map