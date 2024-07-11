import { AbiCoder, JsonRpcProvider, Provider, toBeHex, ZeroAddress } from 'ethers'

import Estimation from '../../../contracts/compiled/Estimation.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { DEPLOYLESS_SIMULATION_FROM, OPTIMISTIC_ORACLE } from '../../consts/deploy'
import { Account, AccountStates } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { getAccountDeployParams, isSmartAccount } from '../account/account'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { fromDescriptor } from '../deployless/deployless'
import { getProbableCallData } from '../gasPrice/gasPrice'
import { TokenResult } from '../portfolio'
import {
  getActivatorCall,
  shouldIncludeActivatorCall,
  shouldUsePaymaster
} from '../userOperation/userOperation'
import { catchEstimationFailure, estimationErrorFormatted, mapTxnErrMsg } from './errors'
import { bundlerEstimate } from './estimateBundler'
import { estimateEOA } from './estimateEOA'
import { estimateGas } from './estimateGas'
import { estimateWithRetries } from './estimateWithRetries'
import { EstimateResult, FeePaymentOption } from './interfaces'
import { refund } from './refund'

const abiCoder = new AbiCoder()

function getInnerCallFailure(estimationOp: { success: boolean; err: string }): Error | null {
  if (estimationOp.success) return null

  let error = mapTxnErrMsg(estimationOp.err)
  if (!error) error = 'Transaction reverted: invalid call in the bundle'
  return new Error(error, {
    cause: 'CALLS_FAILURE'
  })
}

// the outcomeNonce should always be equat to the nonce in accountOp + 1
// that's an indication of transaction success
function getNonceDiscrepancyFailure(op: AccountOp, outcomeNonce: number): Error | null {
  if (op.nonce !== null && op.nonce + 1n === BigInt(outcomeNonce)) return null

  return new Error("Nonce discrepancy, perhaps there's a pending transaction. Retrying...", {
    cause: 'NONCE_FAILURE'
  })
}

export async function estimate4337(
  account: Account,
  op: AccountOp,
  calls: Call[],
  accountStates: AccountStates,
  network: Network,
  provider: JsonRpcProvider | Provider,
  feeTokens: TokenResult[],
  blockTag: string | number,
  nativeToCheck: string[]
): Promise<EstimateResult> {
  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)
  // if no paymaster, user can only pay in native
  const filteredFeeTokens = !shouldUsePaymaster(network)
    ? feeTokens.filter((feeToken) => feeToken.address === ZeroAddress && !feeToken.flags.onGasTank)
    : feeTokens

  // build the feePaymentOptions with the available current amounts. We will
  // change them after simulation passes
  let feePaymentOptions = filteredFeeTokens.map((token: TokenResult) => {
    return {
      paidBy: account.addr,
      availableAmount: token.amount,
      // @relyOnBundler
      // gasUsed goes to 0
      // we add a transfer call or a native call when sending the uOp to the
      // bundler and he estimates that. For different networks this gasUsed
      // goes to different places (callGasLimit or preVerificationGas) and
      // its calculated differently. So it's a wild bet to think we could
      // calculate this on our own for each network.
      gasUsed: 0n,
      // addedNative gets calculated by the bundler & added to uOp gasData
      addedNative: 0n,
      token
    }
  })

  const accountState = accountStates[op.accountAddr][op.networkId]
  const checkInnerCallsArgs = [
    account.addr,
    ...getAccountDeployParams(account),
    [
      account.addr,
      op.accountOpToExecuteBefore?.nonce || 0,
      op.accountOpToExecuteBefore?.calls || [],
      op.accountOpToExecuteBefore?.signature || '0x'
    ],
    [account.addr, op.nonce || 1, calls, '0x'],
    getProbableCallData(account, op, accountState, network),
    account.associatedKeys,
    filteredFeeTokens.map((feeToken) => feeToken.address),
    FEE_COLLECTOR,
    nativeToCheck,
    network.isOptimistic ? OPTIMISTIC_ORACLE : ZeroAddress
  ]
  const estimations = await Promise.all([
    deploylessEstimator
      .call('estimate', checkInnerCallsArgs, {
        from: DEPLOYLESS_SIMULATION_FROM,
        blockTag
      })
      .catch(catchEstimationFailure),
    bundlerEstimate(account, accountStates, op, network, feeTokens),
    estimateGas(account, op, provider, accountState).catch(() => 0n)
  ])
  const ambireEstimation = estimations[0]
  const bundlerEstimationResult: EstimateResult = estimations[1]
  if (ambireEstimation instanceof Error) {
    return estimationErrorFormatted(
      // give priority to the bundler error if both estimations end up with an error
      bundlerEstimationResult.error ?? ambireEstimation,
      {
        feePaymentOptions,
        erc4337GasLimits: {
          preVerificationGas: toBeHex(0),
          verificationGasLimit: toBeHex(0),
          callGasLimit: toBeHex(0),
          paymasterVerificationGasLimit: toBeHex(0),
          paymasterPostOpGasLimit: toBeHex(0),
          gasPrice: {
            slow: { maxFeePerGas: toBeHex(0), maxPriorityFeePerGas: toBeHex(0) },
            medium: { maxFeePerGas: toBeHex(0), maxPriorityFeePerGas: toBeHex(0) },
            fast: { maxFeePerGas: toBeHex(0), maxPriorityFeePerGas: toBeHex(0) },
            ape: { maxFeePerGas: toBeHex(0), maxPriorityFeePerGas: toBeHex(0) }
          }
        }
      }
    )
  }
  // // if there's a bundler error only, remove the smart account payment options
  // if (bundlerEstimationResult instanceof Error) feePaymentOptions = []
  const [
    [
      deployment,
      accountOpToExecuteBefore,
      accountOp,
      outcomeNonce,
      feeTokenOutcomes,
      ,
      nativeAssetBalances,
      ,
      l1GasEstimation
    ]
  ] = estimations[0]
  const ambireEstimationError =
    getInnerCallFailure(accountOp) || getNonceDiscrepancyFailure(op, outcomeNonce)

  bundlerEstimationResult.error =
    bundlerEstimationResult.error instanceof Error
      ? bundlerEstimationResult.error
      : ambireEstimationError

  // if Estimation.sol estimate is a success, it means the nonce has incremented
  // so we subtract 1 from it. If it's an error, we return the old one
  bundlerEstimationResult.currentAccountNonce = accountOp.success
    ? Number(outcomeNonce - 1n)
    : Number(outcomeNonce)

  // if there's a bundler error but there's no ambire estimator error,
  // set the estimation to standard EOA broadcast and continue
  if (!ambireEstimationError && bundlerEstimationResult.error) {
    feePaymentOptions = []
    bundlerEstimationResult.gasUsed =
      deployment.gasUsed + accountOpToExecuteBefore.gasUsed + accountOp.gasUsed
    delete bundlerEstimationResult.erc4337GasLimits
    bundlerEstimationResult.error = null

    // also include the estimate_gas call. If it's bigger, use it
    const estimateGasCall = estimations[2]
    if (bundlerEstimationResult.gasUsed < estimateGasCall)
      bundlerEstimationResult.gasUsed = estimateGasCall
  }

  // add the availableAmount after the simulation
  bundlerEstimationResult.feePaymentOptions = feePaymentOptions.map(
    (option: FeePaymentOption, index: number) => {
      // we do not rewrite the availableAmount if it's gasTank
      if (option.token.flags.onGasTank) return option

      const localOp = { ...option }
      localOp.availableAmount = feeTokenOutcomes[index][1]
      return localOp
    }
  )

  // this is for EOAs paying for SA in native
  const nativeToken = feeTokens.find(
    (token) => token.address === ZeroAddress && !token.flags.onGasTank
  )
  const nativeTokenOptions: FeePaymentOption[] = nativeAssetBalances.map(
    (balance: bigint, key: number) => ({
      paidBy: nativeToCheck[key],
      availableAmount: balance,
      addedNative: l1GasEstimation.fee,
      token: nativeToken
    })
  )
  bundlerEstimationResult.feePaymentOptions = [
    ...bundlerEstimationResult.feePaymentOptions,
    ...nativeTokenOptions
  ]
  return bundlerEstimationResult
}

export async function estimate(
  provider: Provider | JsonRpcProvider,
  network: Network,
  account: Account,
  op: AccountOp,
  accountStates: AccountStates,
  nativeToCheck: string[],
  feeTokens: TokenResult[],
  opts?: {
    calculateRefund?: boolean
    is4337Broadcast?: boolean
  },
  blockFrom: string = '0x0000000000000000000000000000000000000001',
  blockTag: string | number = 'latest'
): Promise<EstimateResult> {
  // if EOA, delegate
  if (!isSmartAccount(account))
    return estimateEOA(
      account,
      op,
      accountStates,
      network,
      provider,
      feeTokens,
      blockFrom,
      blockTag
    )

  if (!network.isSAEnabled)
    return estimationErrorFormatted(
      new Error('Smart accounts are not available for this network. Please use a Basic Account')
    )
  if (!network.areContractsDeployed)
    return estimationErrorFormatted(
      new Error(
        'The Ambire smart contracts are not deployed on this network, yet. You can deploy them via a Basic Account throught the network settings'
      )
    )

  // @EntryPoint activation
  // if the account is v2 without the entry point signer being a signer
  // and the network is 4337 but doesn't have a paymaster and the account
  // is deployed for some reason, we should include the activator
  const calls = [...op.calls]
  const accountState = accountStates[op.accountAddr][op.networkId]
  if (shouldIncludeActivatorCall(network, account, accountState, false)) {
    calls.push(getActivatorCall(op.accountAddr))
  }

  // if 4337, delegate
  if (opts && opts.is4337Broadcast) {
    const estimationResult: EstimateResult = await estimate4337(
      account,
      op,
      calls,
      accountStates,
      network,
      provider,
      feeTokens,
      blockTag,
      nativeToCheck
    )
    return estimationResult
  }

  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)
  const optimisticOracle = network.isOptimistic ? OPTIMISTIC_ORACLE : ZeroAddress

  // if the network doesn't have a relayer, we can't pay in fee tokens
  const filteredFeeTokens = network.hasRelayer ? feeTokens : []

  // @L2s
  // craft the probableTxn that's going to be saved on the L1
  // so we could do proper estimation
  const encodedCallData = abiCoder.encode(
    [
      'bytes', // data
      'address', // to
      'address', // from
      'uint256', // gasPrice
      'uint256', // type
      'uint256', // nonce
      'uint256' // gasLimit
    ],
    [
      getProbableCallData(account, op, accountState, network),
      op.accountAddr,
      FEE_COLLECTOR,
      100000,
      2,
      op.nonce,
      100000
    ]
  )

  const args = [
    account.addr,
    ...getAccountDeployParams(account),
    // @TODO can pass 0 here for the addr
    [
      account.addr,
      op.accountOpToExecuteBefore?.nonce || 0,
      op.accountOpToExecuteBefore?.calls || [],
      op.accountOpToExecuteBefore?.signature || '0x'
    ],
    [account.addr, op.nonce || 1, calls, '0x'],
    encodedCallData,
    account.associatedKeys,
    filteredFeeTokens.map((token) => token.address),
    FEE_COLLECTOR,
    nativeToCheck,
    optimisticOracle
  ]

  const initializeRequests = () => [
    deploylessEstimator
      .call('estimate', args, {
        from: blockFrom,
        blockTag
      })
      .catch(catchEstimationFailure),
    estimateGas(account, op, provider, accountState).catch(() => 0n)
  ]
  const estimations = await estimateWithRetries(initializeRequests)
  if (estimations instanceof Error) return estimationErrorFormatted(estimations)

  const [
    [
      deployment,
      accountOpToExecuteBefore,
      accountOp,
      nonce,
      feeTokenOutcomes,
      ,
      nativeAssetBalances,
      ,
      l1GasEstimation // [gasUsed, baseFee, totalFee, gasOracle]
    ]
  ] = estimations[0]

  let gasUsed = deployment.gasUsed + accountOpToExecuteBefore.gasUsed + accountOp.gasUsed

  // if estimateGas brings a bigger estimation than Estimation.sol, use it
  const customlyEstimatedGas = estimations[1]
  if (gasUsed < customlyEstimatedGas) gasUsed = customlyEstimatedGas

  // WARNING: calculateRefund will 100% NOT work in all cases we have
  // So a warning not to assume this is working
  if (opts?.calculateRefund) gasUsed = await refund(account, op, provider, gasUsed)

  const feeTokenOptions: FeePaymentOption[] = filteredFeeTokens.map(
    (token: TokenResult, key: number) => {
      return {
        paidBy: account.addr,
        availableAmount: token.flags.onGasTank ? token.amount : feeTokenOutcomes[key].amount,
        // gasUsed for the gas tank tokens is smaller because of the commitment:
        // ['gasTank', amount, symbol]
        // and this commitment costs onchain:
        // - 1535, if the broadcasting addr is the relayer
        // - 4035, if the broadcasting addr is different
        // currently, there are more than 1 relayer addresses and we cannot
        // be sure which is the one that will broadcast this txn; also, ERC-4337
        // broadcasts will always consume at least 4035.
        // setting it to 5000n just be sure
        gasUsed: token.flags.onGasTank ? 5000n : feeTokenOutcomes[key].gasUsed,
        addedNative:
          token.address === ZeroAddress
            ? l1GasEstimation.feeWithNativePayment
            : l1GasEstimation.feeWithTransferPayment,
        token
      }
    }
  )

  // this is for EOAs paying for SA in native
  const nativeToken = feeTokens.find(
    (token) => token.address === ZeroAddress && !token.flags.onGasTank
  )
  const nativeTokenOptions: FeePaymentOption[] = nativeAssetBalances.map(
    (balance: bigint, key: number) => ({
      paidBy: nativeToCheck[key],
      availableAmount: balance,
      addedNative: l1GasEstimation.fee,
      token: nativeToken
    })
  )

  return {
    gasUsed,
    // if Estimation.sol estimate is a success, it means the nonce has incremented
    // so we subtract 1 from it. If it's an error, we return the old one
    currentAccountNonce: accountOp.success ? Number(nonce - 1n) : Number(nonce),
    feePaymentOptions: [...feeTokenOptions, ...nativeTokenOptions],
    error: getInnerCallFailure(accountOp) || getNonceDiscrepancyFailure(op, nonce)
  }
}
