import { AbiCoder, Interface, JsonRpcProvider, Provider, toBeHex, ZeroAddress } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import Estimation from '../../../contracts/compiled/Estimation.json'
import Estimation4337 from '../../../contracts/compiled/Estimation4337.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { AMBIRE_PAYMASTER, ERC_4337_ENTRYPOINT, OPTIMISTIC_ORACLE } from '../../consts/deploy'
import { networks as predefinedNetworks } from '../../consts/networks'
import { SPOOF_SIGTYPE } from '../../consts/signatures'
import { Account, AccountStates } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getIsViewOnly } from '../../utils/accounts'
import { getAccountDeployParams, isSmartAccount } from '../account/account'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { fromDescriptor } from '../deployless/deployless'
import { getProbableCallData } from '../gasPrice/gasPrice'
import { UserOperation } from '../userOperation/types'
import {
  getActivatorCall,
  getOneTimeNonce,
  getPaymasterSpoof,
  shouldIncludeActivatorCall,
  shouldUseOneTimeNonce,
  shouldUsePaymaster,
  toUserOperation
} from '../userOperation/userOperation'
import { estimateCustomNetwork } from './customNetworks'
import { catchEstimationFailure, estimationErrorFormatted, mapTxnErrMsg } from './errors'
import { estimateArbitrumL1GasUsed } from './estimateArbitrum'
import { Erc4337estimation, EstimateResult } from './interfaces'

export interface FeeToken {
  address: string
  isGasTank: boolean
  amount: bigint // how much the user has (from portfolio)
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
  const abiCoder = new AbiCoder()
  const optimisticOracle = network.isOptimistic ? OPTIMISTIC_ORACLE : ZeroAddress
  const accountState = accountStates[op.accountAddr][op.networkId]
  const is4337Broadcast = opts && opts.is4337Broadcast
  const isCustomNetwork = !predefinedNetworks.find((net) => net.id === network.id)
  const isSA = isSmartAccount(account)

  // we're excluding the view only accounts from the natives to check
  // in all cases EXCEPT the case where we're making an estimation for
  // the view only account itself. In all other, view only accounts options
  // should not be present as the user cannot pay the fee with them (no key)
  let nativeToCheck = EOAaccounts.filter(
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
      provider.getBalance(account.addr).catch(catchEstimationFailure),
      deploylessEstimator
        .call('getL1GasEstimation', [encodedCallData, FEE_COLLECTOR, optimisticOracle], {
          from: blockFrom,
          blockTag
        })
        .catch(catchEstimationFailure)
    ]
    const result = await reestimate(initializeRequests)
    const [gasUsed, balance, [l1GasEstimation]] =
      result instanceof Error ? [0n, 0n, [{ fee: 0n }]] : result

    return {
      gasUsed,
      nonce,
      feePaymentOptions: [
        {
          address: ZeroAddress,
          paidBy: account.addr,
          availableAmount: balance,
          addedNative: l1GasEstimation.fee,
          isGasTank: false
        }
      ],
      erc4337estimation: null,
      arbitrumL1FeeIfArbitrum: { noFee: 0n, withFee: 0n },
      error: result instanceof Error ? result : null
    }
  }

  if (!network.isSAEnabled)
    return estimationErrorFormatted(
      new Error('Smart accounts are not available for this network. Please use a Basic Account')
    )

  // filter out the fee tokens that are not valid for:
  // - erc4337 without a paymaster - we cannot pay in tokens
  // - non erc4337 custom network - we can only pay in native from EOA
  let filteredFeeTokens = feeTokens
  if (is4337Broadcast) {
    if (!network.erc4337?.hasPaymaster) {
      filteredFeeTokens = filteredFeeTokens.filter(
        (feeToken) => feeToken.address === ZeroAddress && !feeToken.isGasTank
      )
    }

    // native from other accounts are not allowed in ERC-4337
    nativeToCheck = []
  } else if (isCustomNetwork) {
    // if the network is custom and it's not a 4337Broadcast, we cannot pay with
    // the SA as the relayer does not support the network. Our only option becomes
    // basic account paying the fee
    filteredFeeTokens = []
  }

  const userOp = is4337Broadcast ? toUserOperation(account, accountState, op) : null

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
      getProbableCallData(op, accountState, network, userOp),
      op.accountAddr,
      FEE_COLLECTOR,
      100000,
      2,
      op.nonce,
      100000
    ]
  )

  // @EntryPoint activation
  // if the account is v2 without the entry point signer being a signer
  // and the network is 4337 but doesn't have a paymaster, we should activate
  // the entry point and therefore estimate the activator call here
  const calls = [...op.calls]
  if (shouldIncludeActivatorCall(network, accountState)) {
    calls.push(getActivatorCall(op.accountAddr))
  }

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

  // estimate 4337
  const IAmbireAccount = new Interface(AmbireAccount.abi)
  let deployless4337Estimator: any = null
  let functionArgs: any = null
  // a variable with fake user op props for estimation
  let estimateUserOp: UserOperation | null = null
  if (userOp) {
    estimateUserOp = { ...userOp }
    if (shouldUsePaymaster(network)) {
      estimateUserOp.paymasterAndData = getPaymasterSpoof()
    }

    // add the activatorCall to the estimation
    if (estimateUserOp.activatorCall) {
      const localAccOp = { ...op }
      localAccOp.activatorCall = estimateUserOp.activatorCall
      const spoofSig = abiCoder.encode(['address'], [account.associatedKeys[0]]) + SPOOF_SIGTYPE
      estimateUserOp.callData = IAmbireAccount.encodeFunctionData('executeMultiple', [
        [[getSignableCalls(localAccOp), spoofSig]]
      ])
    }

    if (shouldUseOneTimeNonce(estimateUserOp)) {
      estimateUserOp.nonce = getOneTimeNonce(estimateUserOp)
    } else {
      const spoofSig = abiCoder.encode(['address'], [account.associatedKeys[0]]) + SPOOF_SIGTYPE
      estimateUserOp.signature = spoofSig
    }

    functionArgs = [estimateUserOp, ERC_4337_ENTRYPOINT]
    deployless4337Estimator = fromDescriptor(provider, Estimation4337, !network.rpcNoStateOverride)
  }

  /* eslint-disable prefer-const */
  const initializeRequests = () => [
    deploylessEstimator
      .call('estimate', args, {
        from: blockFrom,
        blockTag
      })
      .catch(catchEstimationFailure),
    is4337Broadcast
      ? deployless4337Estimator
          .call('estimate', functionArgs, {
            from: blockFrom,
            blockTag
          })
          .catch((e: any) => e)
      : new Promise((resolve) => {
          resolve(null)
        }),
    estimateArbitrumL1GasUsed(op, account, accountState, provider, estimateUserOp).catch(
      catchEstimationFailure
    ),
    isCustomNetwork
      ? estimateCustomNetwork(account, op, accountStates, network, provider)
      : new Promise((resolve) => {
          resolve(0n)
        })
  ]
  const estimations = await reestimate(initializeRequests)

  // this error usually means there's an RPC issue and we cannot make
  // the estimation at the moment. Say so to the user
  if (estimations instanceof Error) return estimationErrorFormatted(estimations)

  const arbitrumL1FeeIfArbitrum = estimations[2]

  let [
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
  /* eslint-enable prefer-const */

  // if the calls don't pass, we set a CALLS_FAILURE error but
  // allow the execution to proceed.
  // we should explain to the user that the calls don't pass and stop
  // the re-estimation for this accountOp
  let estimationError = null
  if (!accountOp.success) {
    let error = mapTxnErrMsg(accountOp.err)
    if (!error) error = `Estimation failed for ${op.accountAddr} on ${op.networkId}`
    estimationError = new Error(error, {
      cause: 'CALLS_FAILURE'
    })
  }

  let erc4337estimation: Erc4337estimation | null = null
  if (userOp) {
    const [[verificationGasLimit, gasUsed, failure]]: any = estimations[1]

    // if there's an estimation failure, set default values, place the error
    // and allow the code to move on
    if (failure !== '0x') {
      const errorMsg = Buffer.from(failure.substring(2), 'hex').toString()

      let humanReadableMsg = `Failed to estimate a 4337 Request for ${op.accountAddr} on ${op.networkId}`
      if (errorMsg.includes('paymaster deposit too low')) {
        humanReadableMsg = `Paymaster with address ${AMBIRE_PAYMASTER} does not have enough funds to execute this request. Please contact support`
      }
      estimationError = new Error(humanReadableMsg, {
        cause: 'ERC_4337'
      })
      erc4337estimation = {
        userOp,
        gasUsed: 0n
      }
    } else {
      // set the callGasLimit buffer. We take 5% of the gasUsed
      // and compare it with 10k. The bigger one gets added on as a buffer
      const gasLimitBufferInPercentage = gasUsed / 20n // 5%
      const gasLimitBuffer =
        gasLimitBufferInPercentage > 10000n ? gasLimitBufferInPercentage : 10000n

      userOp.verificationGasLimit = toBeHex(BigInt(verificationGasLimit) + 5000n)
      userOp.callGasLimit = toBeHex(gasUsed + gasLimitBuffer)
      erc4337estimation = {
        userOp,
        gasUsed: BigInt(gasUsed) // the minimum for payments
      }
    }
  }

  let gasUsed = erc4337estimation
    ? erc4337estimation.gasUsed
    : deployment.gasUsed + accountOpToExecuteBefore.gasUsed + accountOp.gasUsed

  // for custom networks, we also use estimateGas() to determine the end gasUsed
  // If it's more than the one calculated from our contracts, we use it instead
  if (gasUsed < estimations[3]) gasUsed = estimations[3]

  // WARNING: calculateRefund will 100% NOT work in all cases we have
  // So a warning not to assume this is working
  if (opts?.calculateRefund) {
    const IAmbireAccountFactory = new Interface(AmbireAccountFactory.abi)

    const accountCalldata = op.accountOpToExecuteBefore
      ? IAmbireAccount.encodeFunctionData('executeMultiple', [
          [
            [op.accountOpToExecuteBefore.calls, op.accountOpToExecuteBefore.signature],
            [op.calls, op.signature]
          ]
        ])
      : IAmbireAccount.encodeFunctionData('execute', [op.calls, op.signature])

    const factoryCalldata = IAmbireAccountFactory.encodeFunctionData('deployAndExecute', [
      account.creation!.bytecode,
      account.creation!.salt,
      [[account.addr, 0, accountCalldata]],
      op.signature
    ])

    const estimatedGas = await provider.estimateGas({
      from: '0x0000000000000000000000000000000000000001',
      to: account.creation!.factoryAddr,
      data: factoryCalldata
    })

    const estimatedRefund = gasUsed - estimatedGas

    // As of EIP-3529, the max refund is 1/5th of the entire cost
    if (estimatedRefund <= gasUsed / 5n && estimatedRefund > 0n) gasUsed = estimatedGas
  }

  const feeTokenOptions = feeTokenOutcomes.map((token: any, key: number) => {
    const address = filteredFeeTokens[key].address

    // the l1 fee without any form of payment to relayer/paymaster
    let addedNative = l1GasEstimation.fee

    if (
      !is4337Broadcast || // relayer
      (userOp && shouldUsePaymaster(network))
    ) {
      // add the l1fee with the feeCall according to the type of feeCall
      addedNative =
        address === ZeroAddress
          ? l1GasEstimation.feeWithNativePayment
          : l1GasEstimation.feeWithTransferPayment
    }

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
    addedNative: l1GasEstimation.fee,
    isGasTank: false
  }))

  return {
    gasUsed,
    nonce,
    feePaymentOptions: [...feeTokenOptions, ...nativeTokenOptions],
    erc4337estimation,
    arbitrumL1FeeIfArbitrum,
    error: estimationError
  }
}
