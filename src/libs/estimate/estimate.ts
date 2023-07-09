import { Provider, JsonRpcProvider, Interface } from 'ethers'
import { fromDescriptor } from '../deployless/deployless'
import { getAccountDeployParams } from '../account/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { AccountOp } from '../accountOp/accountOp'
import { Account } from '../../interfaces/account'
import Estimation from '../../../contracts/compiled/Estimation.json'
import { AmbireAccount, AmbireAccountFactory } from '../../../test/config'

export interface EstimateResult {
  gasUsed: bigint
  addedNative?: bigint
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
    calculateAnomalies?: boolean
  },
  fromAddrHavingNative?: string,
  blockFrom: string = '0x0000000000000000000000000000000000000001',
  blockTag: string | number = 'latest'
): Promise<EstimateResult> {
  // @ TODO implement EOAs
  if (!account.creation) throw new Error('EOA not supported yet')
  const deploylessEstimator = fromDescriptor(provider, Estimation, !network.rpcNoStateOverride)

  // @TODO - .env or passed as parameter?
  const relayerAddress = '0x942f9CE5D9a33a82F88D233AEb3292E680230348'

  const calculateAnomalies = opts?.calculateAnomalies && fromAddrHavingNative

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
    calculateAnomalies ? [fromAddrHavingNative].concat(nativeToCheck) : nativeToCheck
  ]

  // @TODO explain this
  const simulationGasPrice = 500000000n
  const simulationGasLimit = 500000n
  const gasPrice = `0x${Number(simulationGasPrice).toString(16)}`
  const gasLimit = `0x${Number(simulationGasLimit).toString(16)}`

  let [
    // eslint-disable-next-line prefer-const
    [deployment, accountOpToExecuteBefore, accountOp, , feeTokenOutcomes, , nativeAssetBalances]
  ] = await deploylessEstimator.call('estimate', args, {
    from: blockFrom,
    blockTag,
    gasPrice: calculateAnomalies ? gasPrice : undefined,
    gasLimit: calculateAnomalies ? gasLimit : undefined
  })

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

  let addedNative
  if (calculateAnomalies) {
    const nativeFromBalance = await provider.getBalance(fromAddrHavingNative!)

    // @TODO - Both balances are equal, but they shouldn't be as the contract balance should include the fee
    console.log({ nativeFromBalance, contractNativeFromBalance: nativeAssetBalances[0] })

    addedNative =
      nativeFromBalance - (nativeAssetBalances[0] - simulationGasPrice * simulationGasLimit)

    nativeAssetBalances = nativeAssetBalances.slice(1)
  }

  return {
    gasUsed,
    addedNative,
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
