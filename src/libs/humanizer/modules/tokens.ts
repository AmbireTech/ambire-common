import { ethers } from 'ethers'
import { AccountOp } from 'libs/accountOp/accountOp'
// @TODO fetch from sonewhere else
// eslint-disable-next-line import/no-extraneous-dependencies
import { HumanizerFragment, Ir, IrCall } from '../interfaces'
import { getLable, getAction, getAddress, getNft, getToken } from '../utils'

async function getTokenInfo(address: string, fetch: Function): Promise<HumanizerFragment | null> {
  try {
    // @TODO network change
    const response = await (
      await fetch(`https://api.coingecko.com/api/v3/coins/ethereum/contract/${address}`)
    ).json()

    if (response.symbol && response.detail_platforms?.ethereum.decimal_place)
      return {
        key: `tokens:${address}`,
        isGlobal: true,
        value: [response.symbol.toUpperCase(), response.detail_platforms?.ethereum.decimal_place]
      }
    return null
  } catch (e) {
    return null
  }
}

function genericErc721Humanizer(
  accountOp: AccountOp,
  currentIr: Ir,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
): [Ir, Promise<any>[]] {
  // @TODO safety checks, some retured as promises
  const iface = new ethers.Interface(accountOp.humanizerMeta?.['abis:ERC721'])
  const nftTransferVisualization = (call: IrCall) => {
    const args = iface.parseTransaction(call)?.args.toArray() || []
    return args[0] === accountOp.accountAddr
      ? [getAction('Transfer'), getNft(call.to, args[2]), getLable('to'), getAddress(args[1])]
      : [
          getAction('Transfer'),
          getNft(call.to, args[2]),
          getLable('from'),
          getAddress(args[0]),
          getLable('to'),
          getAddress(args[1])
        ]
  }
  const matcher = {
    [`${iface.getFunction('approve')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[0] === ethers.ZeroAddress
        ? [getAction('Revoke approval'), getLable('for'), getNft(call.to, args[1])]
        : [
            getAction('Grant approval'),
            getLable('for'),
            getNft(call.to, args[1]),
            getLable('to'),
            getAddress(args[0])
          ]
    },
    [`${iface.getFunction('setApprovalForAll')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[1]
        ? [
            getAction('Grant approval'),
            getLable('for all nfts'),
            getNft(call.to, args[1]),
            getLable('to'),
            getAddress(args[0])
          ]
        : [getAction('Revoke approval'), getLable('for all nfts'), getAddress(args[0])]
    },
    // not in tests
    [`${iface.getFunction('safeTransferFrom', ['address', 'address', 'uint256'])?.selector}`]:
      nftTransferVisualization,
    // [`${
    //   iface.getFunction('safeTransferFrom', ['address', 'address', 'uint256', 'bytes'])
    //     ?.selector
    // }`]: nftTransferVisualization,
    [`${iface.getFunction('transferFrom', ['address', 'address', 'uint256'])?.selector}`]:
      nftTransferVisualization
  }

  const newCalls = currentIr.calls.map((call) => {
    return matcher[call.data.substring(0, 10)] // could do additional check if it is actually NFT contract
      ? {
          ...call,
          fullVisualization: matcher[call.data.substring(0, 10)](call)
        }
      : call
  })
  const newIr = { calls: newCalls }
  return [newIr, []]
}

function genericErc20Humanizer(
  accountOp: AccountOp,
  currentIr: Ir,
  options?: any
): [Ir, Promise<any>[]] {
  // @TODO: check if ${to} is ERC20 (if not in available humanizer data - will be done asyncly and returned as promise)
  // @TODO: check if ${to} is contract when Transfer or transferFrom(_,contract,_)
  // @TODO parse amount according to decimals
  const asyncOps: Promise<any>[] = []
  const iface = new ethers.Interface(accountOp.humanizerMeta?.['abis:ERC20'])
  const matcher = {
    [`${iface.getFunction('approve')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[1] !== BigInt(0)
        ? [
            getAction('Grant approval'),
            getToken(call.to, args[1]),
            getLable('to'),
            getAddress(args[0])
          ]
        : [
            getAction('Revoke approval'),
            getToken(call.to, args[1]),
            getLable('for'),
            getAddress(args[0])
          ]
    },
    [`${iface.getFunction('transfer')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return [
        getAction('Transfer'),
        getToken(call.to, args[1]),
        getLable('to'),
        getAddress(args[0])
      ]
    },
    [`${iface.getFunction('transferFrom')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      // @NOTE: accountOp has module scope, while call has property scope
      if (args[0] === accountOp.accountAddr) {
        return [
          getAction('Transfer'),
          getToken(call.to, args[2]),
          getLable('to'),
          getAddress(args[1])
        ]
      }
      if (args[1] === accountOp.accountAddr) {
        return [
          getAction('Take'),
          getToken(call.to, args[2]),
          getLable('from'),
          getAddress(args[0])
        ]
      }
      return [
        getAction('Move'),
        getToken(call.to, args[2]),
        getLable('from'),
        getAddress(args[0]),
        getLable('to'),
        getAddress(args[1])
      ]
    }
  }
  const newCalls = currentIr.calls.map((call) => {
    // TODO async ops not done
    // if proper func selector and no such token found in meta
    if (matcher[call.data.substring(0, 10)] && !accountOp.humanizerMeta?.[`tokens:${call.to}`]) {
      const asyncTokenInfo = getTokenInfo(call.to, options.fetch)
      asyncOps.push(asyncTokenInfo)
    }
    return matcher[call.data.substring(0, 10)] && accountOp.humanizerMeta?.[`tokens:${call.to}`]
      ? {
          ...call,
          fullVisualization: matcher[call.data.substring(0, 10)](call)
        }
      : call
  })
  const newIr = { calls: newCalls }
  return [newIr, asyncOps]
}

export { genericErc20Humanizer, genericErc721Humanizer }
