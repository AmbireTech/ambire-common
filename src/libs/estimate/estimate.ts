import { AbiCoder, ZeroAddress } from 'ethers'

import { BaseAccount } from 'libs/account/BaseAccount'
import Estimation from '../../../contracts/compiled/Estimation.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { OPTIMISTIC_ORACLE } from '../../consts/deploy'
import { Account, AccountOnchainState, AccountStates } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { getAccountDeployParams, isSmartAccount } from '../account/account'
import { AccountOp, toSingletonCall } from '../accountOp/accountOp'
import { fromDescriptor } from '../deployless/deployless'
import { getHumanReadableEstimationError } from '../errorHumanizer'
import { getProbableCallData } from '../gasPrice/gasPrice'
import { hasRelayerSupport } from '../networks/networks'
import { GasTankTokenResult, TokenResult } from '../portfolio'
import { getActivatorCall, shouldIncludeActivatorCall } from '../userOperation/userOperation'
import {
  ambireEstimateGas,
  getInnerCallFailure,
  getNonceDiscrepancyFailure
} from './ambireEstimation'
import { estimationErrorFormatted } from './errors'
import { bundlerEstimate } from './estimateBundler'
import { estimateEOA } from './estimateEOA'
import { estimateGas } from './estimateGas'
import { estimateWithRetries, retryOnTimeout } from './estimateWithRetries'
import {
  EstimateResult,
  FeePaymentOption,
  FullEstimation,
  FullEstimationSummary
} from './interfaces'
import { providerEstimateGas } from './providerEstimateGas'

const abiCoder = new AbiCoder()

export async function estimate(
  provider: RPCProvider,
  network: Network,
  account: Account,
  op: AccountOp,
  accountStates: AccountStates,
  nativeToCheck: string[],
  feeTokens: TokenResult[],
  errorCallback: Function,
  bundlerSwitcher: BundlerSwitcher,
  opts?: {
    is4337Broadcast?: boolean
  },
  blockFrom: string = '0x0000000000000000000000000000000000000001',
  blockTag: string | number = 'pending'
): Promise<EstimateResult> {
  const accountState = accountStates[op.accountAddr][op.networkId]

  // if EOA & not smarter
  if (!isSmartAccount(account) && !accountState.isSmarterEoa)
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

  if (!network.isSAEnabled && !accountState.isSmarterEoa)
    return estimationErrorFormatted(
      new Error('Smart accounts are not available for this network. Please use a Basic Account')
    )
  if (!network.areContractsDeployed && !accountState.isSmarterEoa)
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
  if (shouldIncludeActivatorCall(network, account, accountState, false)) {
    calls.push(getActivatorCall(op.accountAddr))
  }

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

  const feeTokenOptions: FeePaymentOption[] = filteredFeeTokens.map(
    (token: TokenResult | GasTankTokenResult, key: number) => {
      // We are using 'availableAmount' here, because it's possible the 'amount' to contains pending top up amount as well
      const availableAmount =
        token.flags.onGasTank && 'availableAmount' in token
          ? token.availableAmount || token.amount
          : feeTokenOutcomes[key].amount
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
    error:
      getInnerCallFailure(
        accountOp,
        calls,
        network,
        feeTokens.find((token) => token.address === ZeroAddress && !token.flags.onGasTank)?.amount
      ) || getNonceDiscrepancyFailure(op.nonce!, nonce)
  }
}

// get all possible estimation combinations and leave it to the implementation
// to decide which one is relevant depending on the case.
// there are 3 estimations:
// estimateGas(): the rpc method for retrieving gas
// estimateBundler(): ask the 4337 bundler for a gas price
// Estimation.sol: our own implementation
// each has an use case in diff scenarious:
// - EOA: if payment is native, use estimateGas(); otherwise estimateBundler()
// - SA: if ethereum, use Estimation.sol; otherwise estimateBundler()
export async function getEstimation(
  baseAcc: BaseAccount,
  accountState: AccountOnchainState,
  op: AccountOp,
  network: Network,
  provider: RPCProvider,
  feeTokens: TokenResult[],
  nativeToCheck: string[],
  switcher: BundlerSwitcher,
  errorCallback: Function
): Promise<FullEstimation | Error> {
  const ambireEstimation = ambireEstimateGas(
    baseAcc.getAccount(),
    accountState,
    op,
    network,
    provider,
    feeTokens,
    nativeToCheck
  )
  const bundlerEstimation = bundlerEstimate(
    baseAcc.getAccount(),
    accountState,
    op,
    network,
    feeTokens,
    provider,
    switcher,
    errorCallback
  )
  const providerEstimation = providerEstimateGas(
    baseAcc.getAccount(),
    op,
    provider,
    accountState,
    network,
    feeTokens
  )

  const estimations = await retryOnTimeout(
    () => [ambireEstimation, bundlerEstimation, providerEstimation],
    'estimation-deployless',
    12000
  )
  // this is only if we hit a timeout 5 consecutive times
  if (estimations instanceof Error) return estimations

  const ambireGas = estimations[0]
  const bundlerGas = estimations[1]
  const providerGas = estimations[2]
  const fullEstimation: FullEstimation = {
    provider: providerGas,
    ambire: ambireGas,
    bundler: bundlerGas,
    flags: {}
  }

  console.log('the full estimate')
  console.log(fullEstimation)

  const criticalError = baseAcc.getEstimationCriticalError(fullEstimation)
  if (criticalError) return criticalError

  // TODO: if the bundler is the preferred method of estimation, re-estimate
  // we can switch it if there's no ambire gas error

  let flags = {}
  if (!(ambireGas instanceof Error)) flags = { ...ambireGas.flags }
  if (!(bundlerGas instanceof Error)) flags = { ...bundlerGas.flags }
  return {
    provider: providerGas,
    ambire: ambireGas,
    bundler: bundlerGas,
    flags
  }
}

export function getEstimationSummary(estimation: FullEstimation | Error): FullEstimationSummary {
  if (estimation instanceof Error) {
    return { error: estimation }
  }

  return {
    providerEstimation: !(estimation.provider instanceof Error) ? estimation.provider : undefined,
    ambireEstimation: !(estimation.ambire instanceof Error) ? estimation.ambire : undefined,
    bundlerEstimation: !(estimation.bundler instanceof Error) ? estimation.bundler : undefined
  }
}
