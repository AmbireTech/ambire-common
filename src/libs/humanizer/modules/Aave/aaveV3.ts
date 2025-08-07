import { Interface, MaxUint256 } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { AaveV3Pool } from '../../const/abis'
import { IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getOnBehalfOf,
  getToken
} from '../../utils'

/*
Fetched via
  let maxValueForUint16 = 65535
  let tokenIdsStorageSlot = 54
  let poolAddress = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
  for (let i = 0; i < maxValueForUint16; i++) {
    const storageSlot = solidityPackedKeccak256(['uint256', 'uint256'], [i, tokenIdsStorageSlot])
    const res = await provider.getStorage(poolAddress, storageSlot)
    if (res !== '0x0000000000000000000000000000000000000000000000000000000000000000')
      console.log(res, i)

  pool address is taken from
  https://aave.com/docs/resources/addresses
*/
const AAVE_TOKENS_BY_INDEX: { [chainId: string]: string[] } = {
  '10': [
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
    '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6',
    '0x7f5c764cbc14f9669b88837ca1490cca17c31607',
    '0x68f180fcce6836688e9084f035309e29bf0a2095',
    '0x4200000000000000000000000000000000000006',
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
    '0x76fb31fb4af56892a25e32cfc43de717950c9278',
    '0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9',
    '0x4200000000000000000000000000000000000042',
    '0x1f32b1c2345538c0c6f582fcb022739c4a194ebb',
    '0xc40f949f8a4e094d1b49a23ea9241d289b7b2819',
    '0xdfa46478f9e5ea86d57387849598dbfb2e964b02',
    '0x9bcef72be871e61ed4fbbc7630889bee758eb81d',
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85'
  ],
  '42161': [
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
    '0xf97f4df75117a78c1a5a0dbb814af92458539fb4',
    '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
    '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f',
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
    '0xba5ddd1f9d7f570dc94a51479a000e3bce967196',
    '0xd22a58f79e9481d1a88e00c343885a588b34b68b',
    '0x5979d7b546e38e414f7e9822514be443a4800529',
    '0x3f56e0c36d275367b8c502090edf38289b3dea0d',
    '0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8',
    '0x93b346b6bc2548da6a1e7d98e9a421b42541425b',
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    '0x17fc002b466eec40dae837fc4be5c67993ddbd6f',
    '0x912ce59144191c1204e64559fe8253a0e49e6548',
    '0x35751007a407ca6feffe80b3cb397736d2cf4dbe',
    '0x7dff72693f6a4149b17e7c6314655f6a9f7c8b33',
    '0x2416092f143378750bb29b79ed961ab195cceea5'
  ],
  '43114': [
    '0xd586e7f844cea2f87f50152665bcbc2c279d8d70',
    '0x5947bb275c521040051d82396192181b413227a3',
    '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
    '0x50b7545627a5162f82a992c33b87adc75187b218',
    '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
    '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
    '0x63a72806098bd3d9520cc43356dd78afe5d386d9',
    '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
    '0x2b2c81e08f1af8835a78bb2a90ae924ace0ea4be',
    '0xd24c2ad096400b6fbcd2ad8b24e7acbc21a1da64',
    '0x5c49b268c9841aff1cc3b0a418ff5c3442ee3f3b',
    '0x152b9d0fdc40c096757f570a51e494bd4b943e50',
    '0x00000000efe302beaa2b3e6e1b18d08d69a9012a'
  ],
  '137': [
    '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
    '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39',
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
    '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6',
    '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    '0xd6df932a45c0f255f85145f286ea0b292b21c90b',
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
    '0x172370d5cd63279efa6d502dab29171933a610af',
    '0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a',
    '0x385eeac5cb85a38a9a07a70c73e0a3271cfb54a7',
    '0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3',
    '0x85955046df4668e1dd369d2de9f3aeb98dd2a369',
    '0xe111178a87a3bff0c8d18decba5798827539ae99',
    '0x4e3decbb3645551b8a19f0ea1678079fcb33fb4c',
    '0xe0b52e49357fd4daf2c15e02058dce6bc0057db4',
    '0xa3fa99a148fa48d14ed51d610c367c61876997f1',
    '0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4',
    '0xfa68fb4628dff1028cfec22b4162fccd0d45efb6',
    '0x03b54a6e9a984069379fae1a4fc4dbae93b3bccd',
    '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
  ],
  '8453': [
    '0x4200000000000000000000000000000000000006',
    '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
    '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452',
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a',
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
    '0x2416092f143378750bb29b79ed961ab195cceea5'
  ]
}
export const aaveV3Pool = (): { [key: string]: Function } => {
  const iface = new Interface(AaveV3Pool)
  return {
    [iface.getFunction(
      'supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
    )?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { asset, amount, onBehalfOf, referralCode } = iface.parseTransaction(call)!.args
      return [
        getAction('Deposit'),
        getToken(asset, amount),
        getLabel('to'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction(
      'flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes params, uint16 referralCode)'
    )?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { receiverAddress, asset, amount, params, referralCode } =
        iface.parseTransaction(call)!.args

      return [
        getAction('Execute Flash Loan'),
        getToken(asset, amount),
        getLabel('and call'),
        getAddressVisualization(receiverAddress)
      ]
    },
    [iface.getFunction('repayWithATokens(bytes32 args)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { args } = iface.parseTransaction(call)!.args
      return [getAction('Repay with token A'), getLabel('to'), getAddressVisualization(call.to)]
    },
    [iface.getFunction('repayWithPermit(bytes32 args, bytes32 r, bytes32 s)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { args } = iface.parseTransaction(call)!.args
      return [getAction('Repay with permit'), getLabel('to'), getAddressVisualization(call.to)]
    },
    [iface.getFunction(
      'supplyWithPermit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode, uint256 deadline, uint8 permitV, bytes32 permitR, bytes32 permitS)'
    )?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { asset, amount, onBehalfOf, referralCode, deadline, permitV, permitR, bytes32 } =
        iface.parseTransaction(call)!.args
      return [
        getAction('Supply'),
        getToken(asset, amount),
        getLabel('to'),
        getAddressVisualization(call.to),
        ...(onBehalfOf !== accountOp.accountAddr
          ? [getLabel('on behalf of'), getAddressVisualization(onBehalfOf)]
          : []),
        getDeadline(deadline)
      ]
    },
    [iface.getFunction('withdraw(bytes32 args)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')

      // @TODO  do some hecks for network OR
      const { args } = iface.parseTransaction(call)!.args
      const amountAsString = args.slice(30, 62)
      const tokenIndex = Number(`0x${args.slice(62)}`)
      if (!AAVE_TOKENS_BY_INDEX[accountOp.chainId.toString()])
        return [getAction('Withdraw'), getLabel('from'), getAddressVisualization(call.to)]

      if (tokenIndex >= AAVE_TOKENS_BY_INDEX[accountOp.chainId.toString()].length)
        return [getAction('Withdraw'), getLabel('from'), getAddressVisualization(call.to)]

      // stores amount inn uint128 instead of uint256, but max value is treated as max value
      const amount = amountAsString === 'f'.repeat(32) ? MaxUint256 : BigInt(`0x${amountAsString}`)

      return [
        getAction('Withdraw'),
        getToken(AAVE_TOKENS_BY_INDEX[accountOp.chainId.toString()][tokenIndex], amount),
        getLabel('from'),
        getAddressVisualization(call.to)
      ]
    }
  }
}
