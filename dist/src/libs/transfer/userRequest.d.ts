import { SignUserRequest } from '../../interfaces/userRequest';
import { PaymasterService } from '../erc7677/types';
import { AddrVestingData, ClaimableRewardsData, TokenResult } from '../portfolio';
interface BuildUserRequestParams {
    amount: string;
    selectedToken: TokenResult;
    selectedAccount: string;
    recipientAddress: string;
    paymasterService?: PaymasterService;
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
declare function buildTransferUserRequest({ amount, selectedToken, selectedAccount, recipientAddress: _recipientAddress, paymasterService }: BuildUserRequestParams): SignUserRequest | null;
export { buildClaimWalletRequest, buildMintVestingRequest, buildTransferUserRequest };
//# sourceMappingURL=userRequest.d.ts.map