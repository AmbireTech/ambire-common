import { AbiCoder, encodeRlp, Interface, JsonRpcProvider, Provider } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import Estimation from '../../../contracts/compiled/Estimation.json'
import Estimation4337 from '../../../contracts/compiled/Estimation4337.json'
import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { SPOOF_SIGTYPE } from '../../consts/signatures'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getAccountDeployParams } from '../account/account'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { fromDescriptor } from '../deployless/deployless'
import { getProbableCallData } from '../gasPrice/gasPrice'
import {
  getOneTimeNonce,
  getPaymasterSpoof,
  shouldUseOneTimeNonce,
  shouldUsePaymaster
} from '../userOperation/userOperation'
import { estimateArbitrumL1GasUsed } from './estimateArbitrum'

interface Erc4337estimation {
  verificationGasLimit: bigint
  callGasLimit: bigint
  gasUsed: bigint
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
}

export async function estimate(
  provider: Provider | JsonRpcProvider,
  network: NetworkDescriptor,
  account: Account,
  op: AccountOp,
  accountState: AccountOnchainState,
  nativeToCheck: string[],
  feeTokens: { address: string; isGasTank: boolean; amount: bigint }[],
  opts?: {
    calculateRefund?: boolean
    is4337Broadcast?: boolean
  },
  blockFrom: string = '0x0000000000000000000000000000000000000001',
  blockTag: string | number = 'latest'
): Promise<EstimateResult> {
  const nativeAddr = '0x0000000000000000000000000000000000000000'
  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)
  const abiCoder = new AbiCoder()

  if (!account.creation) {
    if (op.calls.length !== 1) {
      throw new Error("EOA can't have more than one call!")
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

    const [gasUsed, balance, [l1GasEstimation]] = await Promise.all([
      provider.estimateGas({
        from: account.addr,
        to: call.to,
        value: call.value,
        data: call.data,
        nonce
      }),
      provider.getBalance(account.addr),
      deploylessEstimator.call('getL1GasEstimation', [encodeRlp(encodedCallData), '0x'], {
        from: blockFrom,
        blockTag
      })
    ])

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
      arbitrumL1FeeIfArbitrum: { noFee: 0n, withFee: 0n }
    }
  }

  // @TODO - .env or passed as parameter?
  const relayerAddress = '0x942f9CE5D9a33a82F88D233AEb3292E680230348'

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
      getProbableCallData(op, network, accountState),
      op.accountAddr,
      relayerAddress,
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
    relayerAddress,
    nativeToCheck
  ]

  // estimate 4337
  let estimation4337 = new Promise((resolve) => {
    resolve(null)
  })
  const is4337Broadcast = Boolean(opts && opts.is4337Broadcast)
  const usesOneTimeNonce = is4337Broadcast && shouldUseOneTimeNonce(op.asUserOperation!)
  const IAmbireAccount = new Interface(AmbireAccount.abi)
  const userOp = Object.assign({}, op.asUserOperation)
  if (is4337Broadcast) {
    userOp!.paymasterAndData = getPaymasterSpoof()

    // add the activatorCall to the estimation
    if (userOp.activatorCall) {
      const spoofSig = abiCoder.encode(['address'], [account.associatedKeys[0]]) + SPOOF_SIGTYPE
      userOp.callData = IAmbireAccount.encodeFunctionData('executeMultiple', [
        [[getSignableCalls(op), spoofSig]]
      ])
    }

    const deployless4337Estimator = fromDescriptor(
      provider,
      Estimation4337,
      !network.rpcNoStateOverride
    )
    const functionArgs = [userOp, ERC_4337_ENTRYPOINT]
    if (usesOneTimeNonce) {
      userOp.nonce = getOneTimeNonce(userOp)
    } else {
      const spoofSig = abiCoder.encode(['address'], [account.associatedKeys[0]]) + SPOOF_SIGTYPE
      userOp!.signature = spoofSig
    }
    estimation4337 = deployless4337Estimator.call('estimate', functionArgs, {
      from: blockFrom,
      blockTag
    })
  }

  /* eslint-disable prefer-const */
  const estimation = deploylessEstimator.call('estimate', args, {
    from: blockFrom,
    blockTag
  })
  const arbitrumEstimation = estimateArbitrumL1GasUsed(
    op,
    account,
    accountState,
    provider,
    userOp,
    is4337Broadcast
  )
  const estimations = await Promise.all([estimation, estimation4337, arbitrumEstimation])
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

  let erc4337estimation: Erc4337estimation | null = null
  if (is4337Broadcast) {
    const [[verificationGasLimit, gasUsed, failure]]: any = estimations[1]

    // TODO<Bobby>: handle estimation failure
    if (failure !== '0x') {
      console.log(Buffer.from(failure.substring(2), 'hex').toString())
    }

    erc4337estimation = {
      verificationGasLimit: BigInt(verificationGasLimit) + 5000n, // added buffer,
      callGasLimit: BigInt(gasUsed) + 10000n, // added buffer
      gasUsed: BigInt(gasUsed) // the minimum for payments
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
    gasUsed: token.gasUsed,
    addedNative:
      !is4337Broadcast || // relayer
      shouldUsePaymaster(op.asUserOperation!, feeTokens[key].address)
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
    arbitrumL1FeeIfArbitrum
  }
}
