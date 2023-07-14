import { AccountOp } from '../accountOp/accountOp'

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
interface IR {
  data: {
    funcSig: string | null
    args: string | null
    type: string | null
  }
  from: string
  to: string
  amount: bigint
  asset: string | null
}

export function callsToIr(accountOp: AccountOp): IR[] {
  return accountOp.calls.map((call) => {
    const data = {
      funcSig: call.data.slice(0, 10),
      args: call.data.slice(10),
      // could be Swap/Approve/Mint/Buy/Trnsfer/etc
      type: null
    }
    const from = accountOp.accountAddr
    const to = call.to
    const amount = call.value
    return {
      data,
      from,
      to,
      amount,
      asset: null
    }
  })
}

// second to last
// converts all addresses to names
export function naming() {}

// last
// converts all ir to FE-readable format
export function finalizer() {}

// export async function mainHumanizer(accountOp: AccountOp) {
//   const humanizerModules = [genericHumanizer]

//   let currentIr: IR = accountOp.calls.map((call) => ({}))

//   // asyncOps all data that has to be retrieved asyncly
//   const asyncOps = []

//   humanizerModules.forEach((hm) => {
//     let promises = []
//     ;[currentIr, promises] = hm(accountOp, currentIr)

//     if (promises.length) promises.forEach((p) => asyncOps.push(p))
//   })
// }

// function humanize(accountOp, { ...CONSTANTS, addressBook: mainController.addressBook }): [outputIR, Promise<newMeta>] {
//     mainHumanizer()
// }
