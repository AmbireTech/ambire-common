import { AbiCoder, encodeRlp, Interface, JsonRpcProvider, Provider, toBeHex } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import Estimation from '../../../contracts/compiled/Estimation.json'
import Estimation4337 from '../../../contracts/compiled/Estimation4337.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { AMBIRE_PAYMASTER, ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { SPOOF_SIGTYPE } from '../../consts/signatures'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getAccountDeployParams } from '../account/account'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { fromDescriptor } from '../deployless/deployless'
import { getProbableCallData } from '../gasPrice/gasPrice'
import { UserOperation } from '../userOperation/types'
import {
  getOneTimeNonce,
  getPaymasterSpoof,
  shouldUseOneTimeNonce,
  shouldUsePaymaster,
  toUserOperation
} from '../userOperation/userOperation'
import { mapTxnErrMsg } from './errors'
import { estimateArbitrumL1GasUsed } from './estimateArbitrum'

interface Erc4337estimation {
  userOp: UserOperation
  gasUsed: bigint
}

export interface FeeToken {
  address: string
  isGasTank: boolean
  amount: bigint // how much the user has (from portfolio)
}

export interface EstimateResult {
  gasUsed: bigint
  nonce: number
  feePaymentOptions: {
    availableAmount: bigint
    paidBy: string
    address: string
    gasUsed?: bigint
    addedNative: bigint
    isGasTank: boolean
  }[]
  erc4337estimation: Erc4337estimation | null
  arbitrumL1FeeIfArbitrum: { noFee: bigint; withFee: bigint }
  error: Error | null
}

function catchEstimationFailure(e: Error | string | null) {
  let message = null

  if (e instanceof Error) {
    message = e.message
  } else if (typeof e === 'string') {
    message = e
  }

  if (message) {
    message = mapTxnErrMsg(message)
    if (message) return new Error(message)
  }

  return new Error(
    'Estimation failed with unknown reason. Please try again to initialize your request or contact Ambire support'
  )
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
  op: AccountOp,
  accountState: AccountOnchainState,
  EOAaccounts: Account[],
  feeTokens: FeeToken[],
  opts?: {
    calculateRefund?: boolean
    is4337Broadcast?: boolean
  },
  blockFrom: string = '0x0000000000000000000000000000000000000001',
  blockTag: string | number = 'latest'
): Promise<EstimateResult> {
  // we're excluding the view only accounts from the natives to check
  // in all cases EXCEPT the case where we're making an estimation for
  // the view only account itself. In all other, view only accounts options
  // should not be present as the user cannot pay the fee with them (no key)
  const nativeToCheck = EOAaccounts.filter(
    (acc) => acc.addr === op.accountAddr || acc.associatedKeys.length
  ).map((acc) => acc.addr)

  const nativeAddr = '0x0000000000000000000000000000000000000000'
  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)
  const abiCoder = new AbiCoder()

  if (!account.creation) {
    if (op.calls.length !== 1) {
      return {
        gasUsed: 0n,
        nonce: 0,
        feePaymentOptions: [],
        erc4337estimation: null,
        arbitrumL1FeeIfArbitrum: { noFee: 0n, withFee: 0n },
        error: new Error(
          "Trying to make multiple calls with a Basic Account which shouldn't happen. Please try again or contact support."
        )
      }
    }

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
        .call('getL1GasEstimation', [encodeRlp(encodedCallData), '0x'], {
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
          address: nativeAddr,
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

  // is the estimation a 4337 one
  const is4337Broadcast = opts && opts.is4337Broadcast
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
      getProbableCallData(op, accountState, userOp),
      op.accountAddr,
      FEE_COLLECTOR,
      100000000,
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
    [account.addr, op.nonce || 1, op.calls, '0x'],
    encodeRlp(encodedCallData),
    account.associatedKeys,
    feeTokens.map((token) => token.address),
    FEE_COLLECTOR,
    nativeToCheck
  ]

  // estimate 4337
  const IAmbireAccount = new Interface(AmbireAccount.abi)
  let deployless4337Estimator: any = null
  let functionArgs: any = null
  // a variable with fake user op props for estimation
  let estimateUserOp: UserOperation | null = null
  if (userOp) {
    estimateUserOp = { ...userOp }
    estimateUserOp.paymasterAndData = getPaymasterSpoof()

    // add the activatorCall to the estimation
    if (estimateUserOp.activatorCall) {
      const spoofSig = abiCoder.encode(['address'], [account.associatedKeys[0]]) + SPOOF_SIGTYPE
      estimateUserOp.callData = IAmbireAccount.encodeFunctionData('executeMultiple', [
        [[getSignableCalls(op), spoofSig]]
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
    )
  ]
  const estimations = await reestimate(initializeRequests)

  // this error usually means there's an RPC issue and we cannot make
  // the estimation at the moment. Say so to the user
  if (estimations instanceof Error) {
    return {
      gasUsed: 0n,
      nonce: 0,
      feePaymentOptions: [],
      erc4337estimation: null,
      arbitrumL1FeeIfArbitrum: { noFee: 0n, withFee: 0n },
      error: estimations
    }
  }

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
      account.creation.bytecode,
      account.creation.salt,
      [[account.addr, 0, accountCalldata]],
      op.signature
    ])

    const estimatedGas = await provider.estimateGas({
      from: '0x0000000000000000000000000000000000000001',
      to: account.creation.factoryAddr,
      data: factoryCalldata
    })

    const estimatedRefund = gasUsed - estimatedGas

    // As of EIP-3529, the max refund is 1/5th of the entire cost
    if (estimatedRefund <= gasUsed / 5n && estimatedRefund > 0n) gasUsed = estimatedGas
  }

  let finalFeeTokenOptions = feeTokenOutcomes
  let finalNativeTokenOptions = nativeAssetBalances
  if (is4337Broadcast) {
    // if there's no paymaster, we can pay only in native
    if (!network.erc4337?.hasPaymaster) {
      finalFeeTokenOptions = finalFeeTokenOptions.filter((token: any, key: number) => {
        return feeTokens[key].address === '0x0000000000000000000000000000000000000000'
      })
    }

    // native from other accounts are not allowed
    finalNativeTokenOptions = []
  }

  const feeTokenOptions = finalFeeTokenOptions.map((token: any, key: number) => ({
    address: feeTokens[key].address,
    paidBy: account.addr,
    availableAmount: feeTokens[key].isGasTank ? feeTokens[key].amount : token.amount,
    // gasUsed for the gas tank tokens is smaller because of the commitment:
    // ['gasTank', amount, symbol]
    // and this commitment costs onchain:
    // - 1535, if the broadcasting addr is the relayer
    // - 4035, if the broadcasting addr is different
    // currently, there are more than 1 relayer addresses and we cannot
    // be sure which is the one that will broadcast this txn; also, ERC-4337
    // broadcasts will always consume at least 4035.
    // setting it to 5000n just be sure
    gasUsed: feeTokens[key].isGasTank ? 5000n : token.gasUsed,
    addedNative:
      !is4337Broadcast || // relayer
      (userOp && shouldUsePaymaster(userOp, feeTokens[key].address))
        ? l1GasEstimation.feeWithPayment
        : l1GasEstimation.fee,
    isGasTank: feeTokens[key].isGasTank
  }))

  const nativeTokenOptions = finalNativeTokenOptions.map((balance: bigint, key: number) => ({
    address: nativeAddr,
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
