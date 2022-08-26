// TODO: Add more specific types

export interface UseMovrProps {
  fetchGet: any
}

export interface UseMovrReturnType {
  fetchChains: (from: any, to: any) => Promise<any>
  fetchToTokens: (from: any, to: any) => Promise<any>
  fetchFromTokens: (from: any, to: any) => Promise<any>
  fetchQuotes: (
    fromAsset: any,
    fromChainId: any,
    toAsset: any,
    toChainId: any,
    amount: any,
    excludeBridges: any,
    sort?: any
  ) => Promise<any>
  checkApprovalAllowance: (
    chainID: any,
    owner: any,
    allowanceTarget: any,
    tokenAddress: any
  ) => Promise<any>
  approvalBuildTx: (
    chainID: any,
    owner: any,
    allowanceTarget: any,
    tokenAddress: any,
    amount: any
  ) => Promise<any>
  sendBuildTx: (
    recipient: any,
    fromAsset: any,
    fromChainId: any,
    toAsset: any,
    toChainId: any,
    amount: any,
    output: any,
    routePath: any
  ) => Promise<any>
  checkTxStatus: (transactionHash: any, fromChainId: any, toChainId: any) => Promise<any>
}
