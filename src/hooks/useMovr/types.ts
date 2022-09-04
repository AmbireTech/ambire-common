import { NetworkType } from 'constants/networks'

export interface UseMovrProps {
  fetch: any
}

export interface UseMovrReturnType {
  fetchChains: () => Promise<any>
  fetchToTokens: (from: NetworkType['chainId'], to: NetworkType['chainId']) => Promise<any>
  fetchFromTokens: (from: NetworkType['chainId'], to: NetworkType['chainId']) => Promise<any>
  fetchQuotes: (
    fromAsset: string,
    fromChainId: NetworkType['chainId'],
    toAsset: string,
    toChainId: NetworkType['chainId'],
    amount: any,
    excludeBridges: any,
    sort?: any
  ) => Promise<any>
  checkApprovalAllowance: (
    chainID: NetworkType['chainId'],
    owner: any,
    allowanceTarget: any,
    tokenAddress: any
  ) => Promise<any>
  approvalBuildTx: (
    chainID: NetworkType['chainId'],
    owner: any,
    allowanceTarget: any,
    tokenAddress: any,
    amount: any
  ) => Promise<any>
  sendBuildTx: (
    recipient: string,
    fromAsset: string,
    fromChainId: NetworkType['chainId'],
    toAsset: string,
    toChainId: NetworkType['chainId'],
    amount: any,
    output: any,
    routePath: any
  ) => Promise<any>
  checkTxStatus: (
    transactionHash: any,
    fromChainId: NetworkType['chainId'],
    toChainId: NetworkType['chainId']
  ) => Promise<any>
}
