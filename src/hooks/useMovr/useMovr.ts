// TODO: Add more specific types

import { useCallback } from 'react'

import { UseMovrProps, UseMovrReturnType } from './types'

const baseURL = 'https://backend.movr.network/v1'
const watcherBaseURL = 'https://watcherapi.fund.movr.network/api/v1'

const useMovr = ({ fetchGet }: UseMovrProps): UseMovrReturnType => {
  const fetchChains = useCallback(async () => {
    const response = await fetchGet(`${baseURL}/supported/chains`)
    if (!response) return null
    return response.result
  }, [fetchGet])

  const fetchFromTokens = useCallback(
    async (from: any, to: any) => {
      const response = await fetchGet(
        `${baseURL}/supported/from-token-list?fromChainId=${from}&toChainId=${to}`
      )
      if (!response) return null
      return response.result.map(({ token }: any) => token)
    },
    [fetchGet]
  )

  const fetchToTokens = useCallback(
    async (from: any, to: any) => {
      const response = await fetchGet(
        `${baseURL}/supported/to-token-list?fromChainId=${from}&toChainId=${to}`
      )
      if (!response) return null
      return response.result.map(({ token }: any) => token)
    },
    [fetchGet]
  )

  const fetchQuotes = useCallback(
    async (
      fromAsset: any,
      fromChainId: any,
      toAsset: any,
      toChainId: any,
      amount: any,
      excludeBridges: any,
      sort = 'cheapestRoute'
    ) => {
      const response = await fetchGet(
        `${baseURL}/quote?fromAsset=${fromAsset}&fromChainId=${fromChainId}&toAsset=${toAsset}&toChainId=${toChainId}&amount=${amount}&excludeBridges=${excludeBridges}&sort=${sort}`
      )
      if (!response) return null
      return response.result
    },
    [fetchGet]
  )

  const checkApprovalAllowance = useCallback(
    async (chainID: any, owner: any, allowanceTarget: any, tokenAddress: any) => {
      const response = await fetchGet(
        `${baseURL}/approval/check-allowance?chainID=${chainID}&owner=${owner}&allowanceTarget=${allowanceTarget}&tokenAddress=${tokenAddress}`
      )
      if (!response) return null
      return response.result
    },
    [fetchGet]
  )

  const approvalBuildTx = useCallback(
    async (chainID: any, owner: any, allowanceTarget: any, tokenAddress: any, amount: any) => {
      const response = await fetchGet(
        `${baseURL}/approval/build-tx?chainID=${chainID}&owner=${owner}&allowanceTarget=${allowanceTarget}&tokenAddress=${tokenAddress}&amount=${amount}`
      )
      if (!response) return null
      return response.result
    },
    [fetchGet]
  )

  const sendBuildTx = useCallback(
    async (
      recipient: any,
      fromAsset: any,
      fromChainId: any,
      toAsset: any,
      toChainId: any,
      amount: any,
      output: any,
      routePath: any
    ) => {
      const response = await fetchGet(
        `${baseURL}/send/build-tx?recipient=${recipient}&fromAsset=${fromAsset}&fromChainId=${fromChainId}&toAsset=${toAsset}&toChainId=${toChainId}&amount=${amount}&output=${output}&fromAddress=${recipient}&routePath=${routePath}`
      )
      if (!response) return null
      return response.result
    },
    [fetchGet]
  )

  const checkTxStatus = useCallback(
    async (transactionHash: any, fromChainId: any, toChainId: any) => {
      const response = await fetchGet(
        `${watcherBaseURL}/transaction-status?transactionHash=${transactionHash}&fromChainId=${fromChainId}&toChainId=${toChainId}`
      )
      if (!response) return null
      return response.result
    },
    [fetchGet]
  )

  return {
    fetchChains,
    fetchToTokens,
    fetchFromTokens,
    fetchQuotes,
    checkApprovalAllowance,
    approvalBuildTx,
    sendBuildTx,
    checkTxStatus
  }
}

export default useMovr
