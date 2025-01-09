import { AbiCoder, ZeroAddress } from 'ethers'

import Estimation from '../../../contracts/compiled/Estimation.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { DEPLOYLESS_SIMULATION_FROM, OPTIMISTIC_ORACLE } from '../../consts/deploy'
import { Account, AccountStates } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { getAccountDeployParams, isSmartAccount } from '../account/account'
import { AccountOp, toSingletonCall } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { getFeeCall } from '../calls/calls'
import { fromDescriptor } from '../deployless/deployless'
import { InnerCallFailureError } from '../errorDecoder/customErrors'
import { getHumanReadableEstimationError } from '../errorHumanizer'
import { getProbableCallData } from '../gasPrice/gasPrice'
import { hasRelayerSupport } from '../networks/networks'
import { TokenResult } from '../portfolio'
import { getActivatorCall, shouldIncludeActivatorCall } from '../userOperation/userOperation'
import { estimationErrorFormatted } from './errors'
import { bundlerEstimate } from './estimateBundler'
import { estimateEOA } from './estimateEOA'
import { estimateGas } from './estimateGas'
import { getFeeTokenForEstimate } from './estimateHelpers'
import { estimateWithRetries } from './estimateWithRetries'
import { EstimateResult, FeePaymentOption } from './interfaces'
import { refund } from './refund'

const abiCoder = new AbiCoder()

function getInnerCallFailure(estimationOp: { success: boolean; err: string }): Error | null {
  if (estimationOp.success) return null
  const error = getHumanReadableEstimationError(new InnerCallFailureError(estimationOp.err))

  return new Error(error.message, {
    cause: 'CALLS_FAILURE'
  })
}

// the outcomeNonce should always be equal to the nonce in accountOp + 1
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
  provider: RPCProvider,
  feeTokens: TokenResult[],
  blockTag: string | number,
  nativeToCheck: string[],
  errorCallback: Function
): Promise<EstimateResult> {
  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)

  // build the feePaymentOptions with the available current amounts. We will
  // change them after simulation passes
  let feePaymentOptions = feeTokens.map((token: TokenResult) => {
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
    feeTokens.map((feeToken) => feeToken.address),
    FEE_COLLECTOR,
    nativeToCheck,
    network.isOptimistic ? OPTIMISTIC_ORACLE : ZeroAddress
  ]

  // always add a feeCall if available as we're using the paymaster
  // on predefined chains and on custom networks it is better to
  // have a slightly bigger estimation (if we don't have a paymaster)
  const estimateGasOp = { ...op }
  const feeToken = getFeeTokenForEstimate(feeTokens, network)
  if (feeToken) estimateGasOp.feeCall = getFeeCall(feeToken)

  const initializeRequests = () => [
    deploylessEstimator
      .call('estimate', checkInnerCallsArgs, {
        from: DEPLOYLESS_SIMULATION_FROM,
        blockTag
      })
      .catch(getHumanReadableEstimationError),
    bundlerEstimate(account, accountStates, op, network, feeTokens, provider, errorCallback),
    estimateGas(account, estimateGasOp, provider, accountState, network).catch(() => 0n)
  ]
  const estimations = await estimateWithRetries(
    initializeRequests,
    'estimation-deployless',
    errorCallback,
    12000
  )

  const ambireEstimation = estimations[0]
  const bundlerEstimationResult: EstimateResult = estimations[1]
  if (ambireEstimation instanceof Error) {
    return estimationErrorFormatted(
      // give priority to the bundler error if both estimations end up with an error
      bundlerEstimationResult.error ?? ambireEstimation,
      { feePaymentOptions }
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

  // if Estimation.sol estimate is a success, it means the nonce has incremented
  // so we subtract 1 from it. If it's an error, we return the old one
  bundlerEstimationResult.currentAccountNonce = accountOp.success
    ? Number(outcomeNonce - 1n)
    : Number(outcomeNonce)

  if (ambireEstimationError && !bundlerEstimationResult.error) {
    // if there's an ambire estimation error, we do not allow the txn
    // to be executed as it means it will most certainly fail
    bundlerEstimationResult.error = ambireEstimationError
  } else if (!ambireEstimationError && bundlerEstimationResult.error) {
    // if there's a bundler error only, it means we cannot do ERC-4337
    // but we can do broadcast by EOA
    feePaymentOptions = []
    delete bundlerEstimationResult.erc4337GasLimits
    bundlerEstimationResult.error = null
  }

  // set the gasUsed to the biggest one found from all estimations
  const bigIntMax = (...args: bigint[]): bigint => args.reduce((m, e) => (e > m ? e : m))
  const ambireGas = deployment.gasUsed + accountOpToExecuteBefore.gasUsed + accountOp.gasUsed
  const estimateGasCall = estimations[2]
  bundlerEstimationResult.gasUsed = bigIntMax(
    bundlerEstimationResult.gasUsed,
    estimateGasCall,
    ambireGas
  )

  const isPaymasterUsable = !!bundlerEstimationResult.erc4337GasLimits?.paymaster.isUsable()
  bundlerEstimationResult.feePaymentOptions = feePaymentOptions
    .filter((option) => isPaymasterUsable || option.token.address === ZeroAddress)
    .map((option: FeePaymentOption, index: number) => {
      // after simulation: add the left over amount as available
      const localOp = { ...option }
      if (!option.token.flags.onGasTank) {
        localOp.availableAmount = feeTokenOutcomes[index][1]
        localOp.token.amount = feeTokenOutcomes[index][1]
      }

      localOp.gasUsed = localOp.token.flags.onGasTank ? 5000n : feeTokenOutcomes[index][0]
      return localOp
    })

  // this is for EOAs paying for SA in native
  const nativeToken = feeTokens.find(
    (token) => token.address === ZeroAddress && !token.flags.onGasTank
  )
  const nativeTokenOptions: FeePaymentOption[] = nativeAssetBalances.map(
    (balance: bigint, key: number) => ({
      paidBy: nativeToCheck[key],
      availableAmount: balance,
      addedNative: l1GasEstimation.fee,
      token: {
        ...nativeToken,
        amount: balance
      }
    })
  )
  bundlerEstimationResult.feePaymentOptions = [
    ...bundlerEstimationResult.feePaymentOptions,
    ...nativeTokenOptions
  ]
  return bundlerEstimationResult
}

export async function estimate(
  provider: RPCProvider,
  network: Network,
  account: Account,
  op: AccountOp,
  accountStates: AccountStates,
  nativeToCheck: string[],
  feeTokens: TokenResult[],
  errorCallback: Function,
  opts?: {
    calculateRefund?: boolean
    is4337Broadcast?: boolean
  },
  blockFrom: string = '0x0000000000000000000000000000000000000001',
  blockTag: string | number = 'pending'
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
      blockTag,
      errorCallback
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
  const calls = [...op.calls.map(toSingletonCall)]
  const accountState = accountStates[op.accountAddr][op.networkId]
  if (shouldIncludeActivatorCall(network, account, accountState, false)) {
    calls.push(getActivatorCall(op.accountAddr))
  }

  // if 4337, delegate
  if (opts && opts.is4337Broadcast)
    return estimate4337(
      account,
      op,
      calls,
      accountStates,
      network,
      provider,
      feeTokens,
      blockTag,
      nativeToCheck,
      errorCallback
    )

  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)
  const optimisticOracle = network.isOptimistic ? OPTIMISTIC_ORACLE : ZeroAddress

  // if the network doesn't have a relayer, we can't pay in fee tokens
  const filteredFeeTokens = hasRelayerSupport(network) ? feeTokens : []

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
      .catch(getHumanReadableEstimationError),
    estimateGas(account, op, provider, accountState, network).catch(() => 0n)
  ]
  const estimations = await estimateWithRetries(
    initializeRequests,
    'estimation-deployless',
    errorCallback
  )

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
      // We are using 'availableAmount' here, because it's possible the 'amount' to contains pending top up amount as well
      const availableAmount = token.flags.onGasTank ? token.availableAmount || token.amount : feeTokenOutcomes[key].amount
      return {
        paidBy: account.addr,
        availableAmount,
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
        token: {
          ...token,
          amount: availableAmount
        }
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
      token: {
        ...nativeToken,
        amount: balance
      }
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
