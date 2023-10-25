import { Provider, JsonRpcProvider, Interface } from 'ethers'
import { fromDescriptor } from '../deployless/deployless'
import { getAccountDeployParams } from '../account/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { AccountOp } from '../accountOp/accountOp'
import { Account } from '../../interfaces/account'
import Estimation from '../../../contracts/compiled/Estimation.json'
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'

export interface EstimateResult {
  gasUsed: bigint
  nonce: number
  addedNative: bigint
  feePaymentOptions: {
    availableAmount: bigint
    paidBy: string
    address: string
    gasUsed?: bigint
  }[]
}

export async function estimate(
  provider: Provider | JsonRpcProvider,
  network: NetworkDescriptor,
  account: Account,
  op: AccountOp,
  nativeToCheck: string[],
  feeTokens: string[],
  opts?: {
    calculateRefund?: boolean
  },
  blockFrom: string = '0x0000000000000000000000000000000000000001',
  blockTag: string | number = 'latest'
): Promise<EstimateResult> {
  const nativeAddr = '0x0000000000000000000000000000000000000000'

  if (!account.creation) {
    if (op.calls.length !== 1) {
      throw new Error("EOA can't have more than one call!")
    }

    const call = op.calls[0]
    const nonce = await provider.getTransactionCount(account.addr)

    const [gasUsed, balance] = await Promise.all([
      provider.estimateGas({
        from: account.addr,
        to: call.to,
        value: call.value,
        data: call.data,
        nonce
      }),
      provider.getBalance(account.addr)
    ])

    return {
      gasUsed,
      nonce,
      addedNative: 0n,
      feePaymentOptions: [
        {
          address: nativeAddr,
          paidBy: account.addr,
          availableAmount: balance
        }
      ]
    }
  }

  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)

  // @TODO - .env or passed as parameter?
  const relayerAddress = '0x942f9CE5D9a33a82F88D233AEb3292E680230348'

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
    account.associatedKeys,
    feeTokens,
    relayerAddress,
    nativeToCheck
  ]

  /* eslint-disable prefer-const */
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
  ] = await deploylessEstimator.call('estimate', args, {
    from: blockFrom,
    blockTag
  })
  /* eslint-enable prefer-const */

  let gasUsed = deployment.gasUsed + accountOpToExecuteBefore.gasUsed + accountOp.gasUsed

  if (opts?.calculateRefund) {
    const IAmbireAccount = new Interface(AmbireAccount.abi)
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

  const feeTokenOptions = feeTokenOutcomes.map((token: any, key: number) => ({
    address: feeTokens[key],
    paidBy: account.addr,
    availableAmount: token.amount,
    gasUsed: token.gasUsed
  }))

  const nativeTokenOptions = nativeAssetBalances.map((balance: bigint, key: number) => ({
    address: nativeAddr,
    paidBy: nativeToCheck[key],
    availableAmount: balance
  }))

  return {
    gasUsed,
    nonce,
    addedNative: l1GasEstimation.fee || 0n,
    feePaymentOptions: [...feeTokenOptions, ...nativeTokenOptions]
  }
}
