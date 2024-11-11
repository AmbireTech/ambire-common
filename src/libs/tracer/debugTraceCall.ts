import { getAddress, Interface, JsonRpcProvider, toBeHex, toQuantity, ZeroAddress } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import NFTGetter from '../../../contracts/compiled/NFTGetter.json'
// import NFTGetter from '../../../contracts/compiled/NFTGetter.json'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { getAccountDeployParams, getSpoof, isSmartAccount } from '../account/account'
import { AccountOp, callToTuple, getSignableCalls } from '../accountOp/accountOp'
import { DeploylessMode, fromDescriptor } from '../deployless/deployless'
import { GasRecommendation } from '../gasPrice/gasPrice'
import { EOA_SIMULATION_NONCE } from '../portfolio/getOnchainBalances'
// @TODO this is not ok import (GetOptions from ../portfolio/interfaces)
import { GetOptions } from '../portfolio/interfaces'
import { privSlot } from '../proxyDeploy/deploy'

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

// copied frfom getOnchainBalances
// @TODO: figure out how to not import from other libs
function getDeploylessOpts(
  accountAddr: string,
  supportsStateOverride: boolean,
  opts: Partial<GetOptions>
) {
  return {
    blockTag: opts.blockTag,
    from: DEPLOYLESS_SIMULATION_FROM,
    mode:
      supportsStateOverride && opts.isEOA ? DeploylessMode.StateOverride : DeploylessMode.Detect,
    stateToOverride:
      supportsStateOverride && opts.isEOA
        ? {
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
        : null
  }
}

export async function debugTraceCall(
  account: Account,
  op: AccountOp,
  provider: JsonRpcProvider,
  accountState: AccountOnchainState,
  gasUsed: bigint,
  gasPrices: GasRecommendation[],
  supportsStateOverride: boolean,
  overrideData?: any
): Promise<{ tokens: string[]; nfts: [string, bigint[]][] }> {
  const opts = {
    blockTag: 'latest',
    from: DEPLOYLESS_SIMULATION_FROM,
    mode: DeploylessMode.ProxyContract
  }
  const deploylessOpts = getDeploylessOpts(op.accountAddr, supportsStateOverride, opts)
  const [factory, factoryCalldata] = getAccountDeployParams(account)
  // const { accountOps, account } = opts.simulation
  const accountOps = [op]
  const simulationOps = accountOps.map(({ nonce, calls }, idx) => ({
    // EOA starts from a fake, specified nonce
    nonce: isSmartAccount(account) ? nonce : BigInt(EOA_SIMULATION_NONCE) + BigInt(idx),
    calls: calls.map(callToTuple)
  }))

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
          discovered: [],
          fault: function (log) {},
          step: function (log) {
            const found = this.discovered.map(ob => ob.address)
            if (log.contract && log.contract.getAddress() && found.indexOf(toHex(log.contract.getAddress())) === -1) {
              this.discovered.push({
                erc: 20,
                address: toHex(log.contract.getAddress())
              })
            }
            if (log.op.toString() === 'LOG4') {
              this.discovered.push({
                erc: 721,
                address: toHex(log.contract.getAddress()),
                tokenId: '0x' + log.stack.peek(5).toString(16)
              })
            }
          },
          result: function () {
            return this.discovered
          }
        }`,

          enableMemory: false,
          enableReturnData: true,
          disableStorage: true,
          stateOverrides: supportsStateOverride
            ? {
                [params.from]: {
                  balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                },
                ...overrideData
              }
            : {}
        }
      ])
      .catch((e) => {
        console.log(e)
        return [{ erc: 20, address: ZeroAddress }]
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
  const deploylessNfts = fromDescriptor(provider, NFTGetter, supportsStateOverride)

  // const deploylessNfts = fromDescriptor(provider, NFTGetter, true)

  const getNftsPromise = deploylessNfts.call(
    'simulateAndGetAllNFTs',
    [
      op.accountAddr,
      account.associatedKeys,
      foundNftTransfers.map(([address]) => address),
      // @TODO figure out limit with NFT_COLLECTION_LIMIT
      foundNftTransfers.map(([, x]) => x),
      NFT_COLLECTION_LIMIT,
      factory,
      factoryCalldata,
      simulationOps.map((operation) => Object.values(operation))
    ],
    deploylessOpts
  )

  const [[tokensWithErr], [before, after, simulationErr, , , deltaAddressesMapping]] =
    await Promise.all([
      deploylessTokens.call('getBalances', [op.accountAddr, foundTokens], opts),
      getNftsPromise
    ])

  return {
    tokens: foundTokens.filter((addr, i) => tokensWithErr[i].error === '0x'),
    // @TODO fix
    nfts: foundNftTransfers // .filter((nft, i) => nftsWithErr[i].error === '0x')
  }
}
