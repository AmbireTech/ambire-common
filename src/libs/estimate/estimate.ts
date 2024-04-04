import { AbiCoder, JsonRpcProvider, Provider, toBeHex, ZeroAddress } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import Estimation from '../../../contracts/compiled/Estimation.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { DEPLOYLESS_SIMULATION_FROM, OPTIMISTIC_ORACLE } from '../../consts/deploy'
import { networks as predefinedNetworks } from '../../consts/networks'
import { Account, AccountStates } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getIsViewOnly } from '../../utils/accounts'
import { getAccountDeployParams, isSmartAccount } from '../account/account'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { DeploylessMode, fromDescriptor } from '../deployless/deployless'
import { getProbableCallData } from '../gasPrice/gasPrice'
import { EOA_SIMULATION_NONCE } from '../portfolio/getOnchainBalances'
import { privSlot } from '../proxyDeploy/deploy'
import {
  getActivatorCall,
  shouldIncludeActivatorCall,
  shouldUsePaymaster
} from '../userOperation/userOperation'
import { estimateCustomNetwork } from './customNetworks'
import { catchEstimationFailure, estimationErrorFormatted, mapTxnErrMsg } from './errors'
import { estimateArbitrumL1GasUsed } from './estimateArbitrum'
import { bundlerEstimate } from './estimateBundler'
import { ArbitrumL1Fee, EstimateResult, FeeToken } from './interfaces'
import { refund } from './refund'

const abiCoder = new AbiCoder()

// this is the state override we use for the EOA when
// estimating through Estimation.sol
function getEOAEstimationStateOverride(accountAddr: string) {
  return {
    [accountAddr]: {
      code: AmbireAccount.binRuntime,
      stateDiff: {
        // if we use 0x00...01 we get a geth bug: "invalid argument 2: hex number with leading zero digits\" - on some RPC providers
        [`0x${privSlot(0, 'address', accountAddr, 'bytes32')}`]:
          '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        // any number with leading zeros is not supported on some RPCs
        [toBeHex(1, 32)]: EOA_SIMULATION_NONCE
      }
    }
  }
}

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

async function reestimate(fetchRequests: Function, counter: number = 0): Promise<any> {
  // stop the execution on 5 fails;
  // the below error message is not shown to the user so we are safe
  if (counter >= 5)
    return new Error(
      'Estimation failure, retrying in a couple of seconds. If this issue persists, please change your RPC provider or contact Ambire support'
    )

  const estimationTimeout = new Promise((resolve) => {
    setTimeout(() => {
      resolve('Timeout reached')
    }, 15000)
  })

  // try to estimate the request with a given timeout.
  // if the request reaches the timeout, it cancels it and retries
  let result = await Promise.race([Promise.all(fetchRequests()), estimationTimeout])

  if (typeof result === 'string') {
    const incremented = counter + 1
    result = await reestimate(fetchRequests, incremented)
  }

  // if one of the calls returns an error, return it
  if (Array.isArray(result)) {
    const error = result.find((res) => res instanceof Error)
    if (error) return error
  }

  return result
}

export async function estimate4337(
  account: Account,
  op: AccountOp,
  calls: Call[],
  accountStates: AccountStates,
  network: NetworkDescriptor,
  provider: JsonRpcProvider | Provider,
  feeTokens: FeeToken[],
  blockTag: string | number
): Promise<EstimateResult> {
  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)
  // if no paymaster, user can only pay in native
  const filteredFeeTokens = !shouldUsePaymaster(network)
    ? feeTokens.filter((feeToken) => feeToken.address === ZeroAddress && !feeToken.isGasTank)
    : feeTokens
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
    '0x',
    account.associatedKeys,
    filteredFeeTokens.map((feeToken) => feeToken.address),
    ZeroAddress,
    [],
    ZeroAddress
  ]

  const initializeRequests = () => [
    deploylessEstimator
      .call('estimate', checkInnerCallsArgs, {
        from: DEPLOYLESS_SIMULATION_FROM,
        blockTag
      })
      .catch(catchEstimationFailure),
    bundlerEstimate(account, accountStates, op, network, feeTokens)
  ]
  const estimations = await reestimate(initializeRequests)
  if (estimations instanceof Error) return estimationErrorFormatted(estimations)
  const [[, , accountOp, outcomeNonce, feeTokenOutcomes]] = estimations[0]
  const estimationResult: EstimateResult = estimations[1]
  estimationResult.error =
    estimationResult.error instanceof Error
      ? estimationResult.error
      : getInnerCallFailure(accountOp) || getNonceDiscrepancyFailure(op, outcomeNonce)
  estimationResult.currentAccountNonce = Number(outcomeNonce - 1n)

  estimationResult.feePaymentOptions = filteredFeeTokens.map((token: FeeToken, index: number) => {
    return {
      address: token.address,
      paidBy: account.addr,
      availableAmount: feeTokenOutcomes[index][1],
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
      isGasTank: token.isGasTank
    }
  })

  return estimationResult
}

export async function estimate(
  provider: Provider | JsonRpcProvider,
  network: NetworkDescriptor,
  account: Account,
  keystoreKeys: Key[],
  op: AccountOp,
  accountStates: AccountStates,
  EOAaccounts: Account[],
  feeTokens: FeeToken[],
  opts?: {
    calculateRefund?: boolean
    is4337Broadcast?: boolean
  },
  blockFrom: string = '0x0000000000000000000000000000000000000001',
  blockTag: string | number = 'latest'
): Promise<EstimateResult> {
  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)
  const optimisticOracle = network.isOptimistic ? OPTIMISTIC_ORACLE : ZeroAddress
  const accountState = accountStates[op.accountAddr][op.networkId]
  const isCustomNetwork = !predefinedNetworks.find((net) => net.id === network.id)
  const isSA = isSmartAccount(account)

  // we're excluding the view only accounts from the natives to check
  // in all cases EXCEPT the case where we're making an estimation for
  // the view only account itself. In all other, view only accounts options
  // should not be present as the user cannot pay the fee with them (no key)
  const nativeToCheck = EOAaccounts.filter(
    (acc) => acc.addr === op.accountAddr || !getIsViewOnly(keystoreKeys, acc.associatedKeys)
  ).map((acc) => acc.addr)

  if (!isSA) {
    if (op.calls.length !== 1)
      return estimationErrorFormatted(
        new Error(
          "Trying to make multiple calls with a Basic Account which shouldn't happen. Please try again or contact support."
        )
      )

    const call = op.calls[0]
    const nonce = await provider.getTransactionCount(account.addr)
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
      [call.data, call.to, account.addr, 100000000, 2, nonce, 100000]
    )
    const initializeRequests = () => [
      provider
        .estimateGas({
          from: account.addr,
          to: call.to,
          value: call.value,
          data: call.data,
          nonce
        })
        .catch(catchEstimationFailure),
      !network.rpcNoStateOverride
        ? deploylessEstimator
            .call(
              'estimateEoa',
              [
                account.addr,
                [account.addr, EOA_SIMULATION_NONCE, op.calls, '0x'],
                encodedCallData,
                [account.addr],
                FEE_COLLECTOR,
                optimisticOracle
              ],
              {
                from: blockFrom,
                blockTag,
                mode: DeploylessMode.StateOverride,
                stateToOverride: getEOAEstimationStateOverride(account.addr)
              }
            )
            .catch(catchEstimationFailure)
        : deploylessEstimator
            .call('getL1GasEstimation', [encodedCallData, FEE_COLLECTOR, optimisticOracle], {
              from: blockFrom,
              blockTag
            })
            .catch(catchEstimationFailure)
    ]
    const result = await reestimate(initializeRequests)
    const feePaymentOptions = [
      {
        address: ZeroAddress,
        paidBy: account.addr,
        availableAmount: accountState.balance,
        addedNative: 0n,
        isGasTank: false
      }
    ]
    if (result instanceof Error) return estimationErrorFormatted(result, feePaymentOptions)

    let gasUsed = 0n
    if (!network.rpcNoStateOverride) {
      const [gasUsedEstimateGas, [gasUsedEstimationSol, feeTokenOutcomes, l1GasEstimation]] = result
      console.log(gasUsedEstimationSol)
      console.log(gasUsedEstimationSol)
      console.log(l1GasEstimation)
      feePaymentOptions[0].availableAmount = feeTokenOutcomes[0][1]
      feePaymentOptions[0].addedNative = l1GasEstimation.fee
      gasUsed =
        gasUsedEstimateGas > gasUsedEstimationSol ? gasUsedEstimateGas : gasUsedEstimationSol
    } else {
      const [gasUsedEstimateGas, [l1GasEstimation]] = result
      feePaymentOptions[0].addedNative = l1GasEstimation.fee
      gasUsed = gasUsedEstimateGas
    }

    return {
      gasUsed,
      currentAccountNonce: nonce,
      feePaymentOptions,
      error: result instanceof Error ? result : null
    }
  }

  if (!network.isSAEnabled)
    return estimationErrorFormatted(
      new Error('Smart accounts are not available for this network. Please use a Basic Account')
    )

  // @EntryPoint activation
  // if the account is v2 without the entry point signer being a signer
  // and the network is 4337 but doesn't have a paymaster, we should activate
  // the entry point and therefore estimate the activator call here
  const calls = [...op.calls]
  if (shouldIncludeActivatorCall(network, accountState)) {
    calls.push(getActivatorCall(op.accountAddr))
  }

  if (opts && opts.is4337Broadcast) {
    const estimationResult: EstimateResult = await estimate4337(
      account,
      op,
      calls,
      accountStates,
      network,
      provider,
      feeTokens,
      blockTag
    )
    return estimationResult
  }

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
      getProbableCallData(op, accountState, network),
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
    estimateArbitrumL1GasUsed(op, account, accountState, provider).catch(catchEstimationFailure),
    isCustomNetwork
      ? estimateCustomNetwork(account, op, accountStates, network, provider)
      : new Promise((resolve) => {
          resolve(0n)
        })
  ]
  const estimations = await reestimate(initializeRequests)
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

  // we're touching the calculations for custom networks only
  // customlyEstimatedGas is 0 when the network is not custom
  const customlyEstimatedGas = estimations[2]
  if (gasUsed < customlyEstimatedGas) gasUsed = customlyEstimatedGas

  // WARNING: calculateRefund will 100% NOT work in all cases we have
  // So a warning not to assume this is working
  if (opts?.calculateRefund) gasUsed = await refund(account, op, provider, gasUsed)

  // if the network is arbitrum, we get the addedNative from the arbitrum
  // estimation. Otherwise, we get it from the OP stack oracle
  // if the network is not an L2, all these will default to 0n
  const arbitrumEstimation: ArbitrumL1Fee = estimations[1]
  const l1Fee = network.id !== 'arbitrum' ? l1GasEstimation.fee : arbitrumEstimation.noFee
  const l1FeeWithNativePayment =
    network.id !== 'arbitrum' ? l1GasEstimation.feeWithNativePayment : arbitrumEstimation.withFee
  const l1FeeWithTransferPayment =
    network.id !== 'arbitrum' ? l1GasEstimation.feeWithTransferPayment : arbitrumEstimation.withFee

  const feeTokenOptions = feeTokenOutcomes.map((token: any, key: number) => {
    const address = filteredFeeTokens[key].address
    const addedNative = address === ZeroAddress ? l1FeeWithNativePayment : l1FeeWithTransferPayment

    return {
      address,
      paidBy: account.addr,
      availableAmount: filteredFeeTokens[key].isGasTank
        ? filteredFeeTokens[key].amount
        : token.amount,
      // gasUsed for the gas tank tokens is smaller because of the commitment:
      // ['gasTank', amount, symbol]
      // and this commitment costs onchain:
      // - 1535, if the broadcasting addr is the relayer
      // - 4035, if the broadcasting addr is different
      // currently, there are more than 1 relayer addresses and we cannot
      // be sure which is the one that will broadcast this txn; also, ERC-4337
      // broadcasts will always consume at least 4035.
      // setting it to 5000n just be sure
      gasUsed: filteredFeeTokens[key].isGasTank ? 5000n : token.gasUsed,
      addedNative,
      isGasTank: filteredFeeTokens[key].isGasTank
    }
  })

  // this is for EOAs paying for SA in native
  // or the current address if it's an EOA
  const nativeTokenOptions = nativeAssetBalances.map((balance: bigint, key: number) => ({
    address: ZeroAddress,
    paidBy: nativeToCheck[key],
    availableAmount: balance,
    addedNative: l1Fee,
    isGasTank: false
  }))

  return {
    gasUsed,
    // the nonce from EstimateResult is incremented but we always want
    // to return the current nonce. That's why we subtract 1
    currentAccountNonce: Number(nonce - 1n),
    feePaymentOptions: [...feeTokenOptions, ...nativeTokenOptions],
    error: getInnerCallFailure(accountOp) || getNonceDiscrepancyFailure(op, nonce)
  }
}
