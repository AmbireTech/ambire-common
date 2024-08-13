import { getAddress, Interface, JsonRpcProvider, toQuantity, ZeroAddress } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import NFTGetter from '../../../contracts/compiled/NFTGetter.json'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { getSpoof } from '../account/account'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { DeploylessMode, fromDescriptor } from '../deployless/deployless'
import { GasRecommendation } from '../gasPrice/gasPrice'

const NFT_COLLECTION_LIMIT = 100
// if using EOA, use the first and only call of the account op
// if it's SA, make the data execute or deployAndExecute,
// set the spoof+addr and pass all the calls
function getFunctionParams(account: Account, op: AccountOp, accountState: AccountOnchainState) {
  if (!account.creation) {
    const call = op.calls[0]
    return {
      to: call.to,
      value: toQuantity(call.value.toString()),
      data: call.data,
      from: op.accountAddr
    }
  }

  const saAbi = new Interface(AmbireAccount.abi)
  const factoryAbi = new Interface(AmbireFactory.abi)
  const callData = accountState.isDeployed
    ? saAbi.encodeFunctionData('execute', [getSignableCalls(op), getSpoof(account)])
    : factoryAbi.encodeFunctionData('deployAndExecute', [
        account.creation.bytecode,
        account.creation.salt,
        getSignableCalls(op),
        getSpoof(account)
      ])

  return {
    from: DEPLOYLESS_SIMULATION_FROM,
    to: accountState.isDeployed ? account.addr : account.creation.factoryAddr,
    value: 0,
    data: callData
  }
}

export async function debugTraceCall(
  account: Account,
  op: AccountOp,
  provider: JsonRpcProvider,
  accountState: AccountOnchainState,
  gasUsed: bigint,
  gasPrices: GasRecommendation[],
  supportsStateOverride: boolean
): Promise<{ tokens: string[]; nfts: [string, bigint[]][] }> {
  const fast = gasPrices.find((gas: any) => gas.name === 'fast')
  if (!fast) return { tokens: [], nfts: [] }

  const gasPrice =
    'gasPrice' in fast ? fast.gasPrice : fast.baseFeePerGas + fast.maxPriorityFeePerGas

  const params = getFunctionParams(account, op, accountState)
  const results: ({ erc: 20; address: string } | { erc: 721; address: string; tokenId: string })[] =
    await provider
      .send('debug_traceCall', [
        {
          to: params.to,
          value: toQuantity(params.value.toString()),
          data: params.data,
          from: params.from,
          gasPrice: toQuantity(gasPrice.toString()),
          gas: toQuantity(gasUsed.toString())
        },
        'latest',
        {
          tracer: `{
          data: [], 
          fault: function (log) {}, 
          step: function (log) { 
            if (log.op.toString() === 'LOG3') {
              this.data.push({
                erc: 20,
                address: toHex(log.contract.getAddress())
              })
            }
            if (log.op.toString() === 'LOG4') { 
              this.data.push({
                erc: 721,
                address: toHex(log.contract.getAddress()),
                tokenId: '0x' + log.stack.peek(5).toString(16)
              })
            }
          }, 
          result: function () { 
            return this.data 
          }
        }`,

          enableMemory: false,
          enableReturnData: true,
          disableStorage: true,
          stateOverrides: supportsStateOverride
            ? {
                [params.from]: {
                  balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                }
              }
            : {}
        }
      ])
      .catch((e) => {
        console.log(e)
        return [ZeroAddress]
      })

  const foundTokens = [
    ...new Set(results.filter((i) => i?.erc === 20).map((i) => getAddress(i.address)))
  ]
  const foundNftTransfersObject = results
    .filter((i) => i?.erc === 721)
    .reduce((res: { [address: string]: Set<bigint> }, i: any) => {
      if (!res[i?.address]) res[i?.address] = new Set()
      res[i.address].add(i.tokenId)
      return res
    }, {})
  const foundNftTransfers: [string, bigint[]][] = Object.entries(foundNftTransfersObject).map(
    ([address, id]) => [getAddress(address), Array.from(id).map((i) => BigInt(i))]
  )

  // we set the 3rd param to "true" as we don't need state override
  const deploylessTokens = fromDescriptor(provider, BalanceGetter, true)
  const deploylessNfts = fromDescriptor(provider, NFTGetter, true)

  const opts = {
    blockTag: 'latest',
    from: DEPLOYLESS_SIMULATION_FROM,
    mode: DeploylessMode.ProxyContract
  }
  const [[tokensWithErr], [nftsWithErr]] = await Promise.all([
    deploylessTokens.call('getBalances', [op.accountAddr, foundTokens], opts),
    deploylessNfts.call(
      'getAllNFTs',
      [
        op.accountAddr,
        foundNftTransfers.map((i) => i[0]),
        foundNftTransfers.map((i) => i[1]),
        NFT_COLLECTION_LIMIT
      ],
      opts
    )
  ])
  return {
    tokens: foundTokens.filter((addr, i) => tokensWithErr[i].error === '0x'),
    nfts: foundNftTransfers.filter((nft, i) => nftsWithErr[i].error === '0x')
  }
}
