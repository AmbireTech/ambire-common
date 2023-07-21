import { ethers } from 'ethers'
import { AccountOp } from '../accountOp/accountOp'
import IERC20 from '../../../contracts/compiled/IERC20.json'

function getLable(content: string) {
  return { type: 'lable', content }
}
function getAction(content: string) {
  return { type: 'action', content }
}
function getAddress(address: string, name?: string) {
  return name ? { type: 'address', address, name } : { type: 'address', address }
}

function getToken(address: string, amount: bigint) {
  return { type: 'token', address, amount }
}
/*
// types of transactions to account for

// primary transaction types
// sending eth
// contract calls
// contract deployment and destruction

// secondary transaction types
// sending ERC-20 or NFTs
// other contract calls (/w & /wo eth)
// overriding gas

// honorable mentions
// swapping

// warnings
// sending eth to contracts
// sending tokens to contracts
// sending funds to unused addresses
*/
export interface IrCall {
  data: string
  to: string
  value: bigint
  fullVisualization: any
}

export interface Ir {
  calls: IrCall[]
}

export function callsToIr(accountOp: AccountOp): Ir {
  const irCalls: IrCall[] = accountOp.calls.map((call) => {
    return {
      data: call.data,
      to: call.to,
      value: call.value,
      fullVisualization: null
    }
  })
  return { calls: irCalls }
}

export function genericErc20Humanizer(accountOp: AccountOp, currentIr: Ir): [Ir, Promise<any>[]] {
  // @TODO: check if ${to} is ERC20 (if not in available humanizer data - will be done asyncly and returned as promise)
  // @TODO: check if ${to} is contract when Transfer or transferFrom(_,contract,_)
  // @TODO parse amount according to decimals
  const iface = new ethers.Interface(IERC20.abi)
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
    return matcher[call.data.substring(0, 10)] && accountOp.humanizerMeta?.tokens[call.to]
      ? {
          ...call,
          fullVisualization: matcher[call.data.substring(0, 10)](call)
        }
      : call
  })
  const newIr = { calls: newCalls }
  return [newIr, []]
}
function shortenAddress(addr: string): string {
  return addr ? `${addr.slice(0, 5)}...${addr.slice(-3)}` : ''
}

// adds 'name' proeprty to visualization of addresses (needs initialHumanizer to work on unparsed transactions)
export function namingHumanizer(accountOp: AccountOp, currentIr: Ir): [Ir, Promise<any>[]] {
  const newCalls = currentIr.calls.map((call) => {
    const newVisualization = call.fullVisualization?.map((v: any) => {
      return v.type === 'address'
        ? {
            ...v,
            // in case of more sophisticated name resolutions
            // new name function so it can be getName() || shortenAddress() ????????
            name:
              accountOp.humanizerMeta?.names[v.address.toLowerCase()] ||
              (accountOp.humanizerMeta?.tokens[v.address.toLowerCase()]
                ? `${accountOp.humanizerMeta?.tokens[v.address.toLowerCase()]?.[0]} contract`
                : null) ||
              shortenAddress(v.address)
          }
        : v
    })
    return { ...call, fullVisualization: newVisualization || call.fullVisualization }
  })
  const newIr = { ...currentIr, calls: newCalls }
  return [newIr, []]
}

// goes over all transactions to provide basic visuzlization
export function initialHumanizer(accountOp: AccountOp, currentIr: Ir): [Ir, Promise<any>[]] {
  const newCalls = currentIr.calls.map((call) => {
    let fullVisualization
    if (call.data === '0x') {
      fullVisualization = [
        getAction('Sending'),
        getToken(ethers.ZeroAddress, call.value),
        getLable('to'),
        getAddress(call.to)
      ]
    } else if (call.value === BigInt(0)) {
      fullVisualization = [getAction('Interacting with'), getAddress(call.to)]
    } else {
      fullVisualization = [
        getAction('Interacting with'),
        getAddress(call.to),
        getLable('and'),
        getAction('Sending'),
        getToken(ethers.ZeroAddress, call.value)
      ]
    }
    return { ...call, fullVisualization }
  })
  const newIr = { calls: newCalls }
  return [newIr, []]
}

export async function humanize(accountOp: AccountOp) {
  const humanizerModules = [initialHumanizer, genericErc20Humanizer, namingHumanizer]

  let currentIr: Ir = callsToIr(accountOp)

  // asyncOps all data that has to be retrieved asyncly
  let asyncOps: any[] = []

  humanizerModules.forEach((hm) => {
    let promises = []
    ;[currentIr, promises] = hm(accountOp, currentIr)
    asyncOps = [...asyncOps, ...promises]
  })
}
