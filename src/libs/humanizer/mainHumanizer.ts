import { ethers } from 'ethers'
import { AccountOp } from '../accountOp/accountOp'
import IERC20 from '../../../contracts/compiled/IERC20.json'
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

// second to last
// converts all addresses to names
// export function naming(accountOp: AccountOp, currentIr: IR[]): [IR[], Promise<any>[]] {}

// last
// converts all ir to FE-readable format
// export function finalizer() {}

export function genericErc20Humanizer(accountOp: AccountOp, currentIr: Ir): [Ir, Promise<any>[]] {
  // @TODO: check if ${to} is ERC20 (will be done asyncly and returned as promise)
  // @TODO: check if ${to} is contract when Transfer
  const iface = new ethers.Interface(IERC20.abi)
  const matcher = {
    [`${iface.getFunction('approve')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[1] === BigInt(0)
        ? [
            { type: 'action', content: 'Grant approval' },
            { type: 'token', address: call.to, amount: args[1] },
            { type: 'label', content: 'to' },
            { type: 'address', address: args[0] }
          ]
        : [
            { type: 'action', content: 'Revoke approval' },
            { type: 'token', address: call.to, amount: args[1] },
            { type: 'label', content: 'for' },
            { type: 'address', address: args[0] }
          ]
    },
    [`${iface.getFunction('transfer')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return [
        { type: 'action', content: 'Transfer' },
        { type: 'token', address: call.to, amount: args[1] },
        { type: 'label', content: 'to' },
        { type: 'address', address: args[0] }
      ]
    }
  }
  iface.getFunction('approve')?.selector
  const newCalls = currentIr.calls.map((call) => {
    return matcher[call.data.substring(0, 10)]
      ? {
          ...call,
          fullVisualization: matcher[call.data.substring(0, 10)](call)
        }
      : call
  })
  const newIr = { calls: newCalls }
  return [newIr, []]
}

export async function humanize(accountOp: AccountOp) {
  const humanizerModules = [genericErc20Humanizer]

  let currentIr: Ir = callsToIr(accountOp)

  // asyncOps all data that has to be retrieved asyncly
  let asyncOps: any[] = []

  humanizerModules.forEach((hm) => {
    let promises = []
    ;[currentIr, promises] = hm(accountOp, currentIr)
    asyncOps = [...asyncOps, ...promises]
  })
}
