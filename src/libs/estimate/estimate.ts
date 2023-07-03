import { Provider, JsonRpcProvider, Interface } from 'ethers'
import { fromDescriptor } from '../deployless/deployless'
import { getAccountDeployParams } from '../account/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { AccountOp } from '../accountOp/accountOp'
import { Account } from '../../interfaces/account'
import estimator from './estimator.json'
import { AmbireAccount, AmbireAccountFactory } from '../../../test/config'

export interface EstimateResult {
  gasUsed: bigint
  feeTokenOutcome: {
    address: string
    gasUsed: bigint
    balance: bigint
  }[]
  nativeAssetBalances: {
    address: string
    balance: bigint
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
  // @ TODO implement EOAs
  if (!account.creation) throw new Error('EOA not supported yet')
  const deploylessEstimator = fromDescriptor(provider, estimator, !network.rpcNoStateOverride)

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

  // eslint-disable-next-line prefer-const
  let [[, , , , feeTokenOutcomes, , nativeAssetBalances, gasUsed]] = await deploylessEstimator.call(
    'estimate',
    args,
    {
      from: blockFrom,
      blockTag
    }
  )

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
    // @TODO - in case of accountOpToExecuteBefore, estimatedRefund is a negative number.
    // 1. Check data we pass for accountOpToExecuteBefore (maybe it's wrong)
    // 2. Is there any possibility for such negative case? How do will handle it?
    if (estimatedRefund <= gasUsed / 5n && estimatedRefund > 0n) gasUsed = estimatedGas
  }

  // @TODO - addedNative

  return {
    gasUsed,
    feeTokenOutcome: feeTokenOutcomes.map((token: any, key: number) => ({
      address: feeTokens[key],
      gasUsed: token.gasUsed,
      balance: token.amount
    })),
    nativeAssetBalances: nativeAssetBalances.map((balance: bigint, key: number) => ({
      address: nativeToCheck[key],
      balance
    }))
  }
}
