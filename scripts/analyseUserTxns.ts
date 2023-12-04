import dotenv from 'dotenv'
import axios from 'axios'
import fetch from 'node-fetch'
import { ethers } from 'ethers'
import { IrCall } from '../src/libs/humanizer/interfaces'
import { visualizationToText } from '../src/libs/humanizer/humanizerFuncs'
import { Storage } from '../src/interfaces/storage'
import { abi as AmbireAccountFactory } from '../contracts/compiled/AmbireAccountFactory.json'
import { abi as AmbireAccount } from '../contracts/compiled/AmbireAccount.json'
import { stringify, parse } from '../src/libs/bigintJson/bigintJson'
import { AccountOp } from '../src/libs/accountOp/accountOp'
import { callsHumanizer } from '../src/libs/humanizer'
import humanizerJSON from '../src/consts/humanizerInfo.json'

dotenv.config()
const AmbireAccountFactoryInterface = new ethers.Interface(AmbireAccountFactory)
const AmbireAccountInterface = new ethers.Interface(AmbireAccount)

const targetAddress = '0xbf07a0df119ca234634588fbdb5625594e2a5bca'
const blockExplorers: { [network: string]: { url: string; key: string } } = {
  ethereum: { url: 'https://api.etherscan.io/api', key: 'X5QFMW2RHPNPSEW532JQJQDH6BVIV2RM47' },
  polygon: { url: 'https://api.polygonscan.com/api', key: 'JWBB58PYVH1AZ1K4YNF1S22DT1MAQCYMA5' },
  optimism: {
    url: 'https://api-optimistic.etherscan.io/api',
    key: 'UCUHXPSB2MUUFNN12WXI9NQ7D48U2FV42U'
  }
  //   arbitrum: { url: 'https://api.arbiscan.io/api', key: 'K4315P6SZPCPDJ78UNYNXJUIPTDKE2UFTT' }
}

function produceMemoryStore(): Storage {
  const storage = new Map()

  return {
    get: (key: any, defaultValue: any): any => {
      const serialized = storage.get(key)
      return Promise.resolve(serialized ? parse(serialized) : defaultValue)
    },
    set: (key: any, value: any) => {
      storage.set(key, stringify(value))
      return Promise.resolve(null)
    }
  }
}

async function getAllLogsForContract(network: string, page: number) {
  try {
    const response = await axios.get(blockExplorers?.[network].url, {
      params: {
        module: 'logs',
        action: 'getLogs',
        address: targetAddress,
        fromBlock: 0,
        page,
        toBlock: 'latest',
        apiKey: blockExplorers?.[network].key,
        offset: 1000
      }
    })

    const logs = response.data.result

    if (logs && logs.length > 0) {
      const addresses = logs.map(
        (l: any) =>
          AmbireAccountFactoryInterface.parseLog({
            topics: l.topics,
            data: l.data
          })?.args[0]
      )
      return addresses
    }
    console.log('No logs found for the contract.')
  } catch (error) {
    console.error(error)
  }
}

async function getAllAddresses() {
  const result = await Promise.all(
    Object.keys(blockExplorers).map(async (network) => {
      const totalAddresses = []
      let newAddresses = []
      let i = 0
      do {
        // eslint-disable-next-line no-await-in-loop
        newAddresses = await getAllLogsForContract(network, i)
        totalAddresses.push(...newAddresses)
        i += 1
      } while (newAddresses.length === 1000)
      return [network, totalAddresses]
    })
  )
  console.log(JSON.stringify(Object.fromEntries(result), null, 4))
}

// getAllAddresses()

async function getLatestuserTxns(network: string, address: string) {
  try {
    const response = await axios.get(blockExplorers?.[network].url, {
      params: {
        module: 'account',
        action: 'txlist',
        address,
        startblock: 0,
        endblock: 99999999,
        page: 1,
        offset: 100,
        sort: 'desc',
        apikey: blockExplorers?.[network].key
      }
    })
    return response.data.result.map(
      (txn: any) =>
        AmbireAccountInterface.parseTransaction({
          data: txn.input
        })?.args[0]
    )
  } catch (e) {
    return []
  }
}

async function getAllNeededData() {
  //   const allAddresses = {
  //     ethereum: ['0xbC1694cC66a71731d90e45Ad14F22FDb4E447A48']
  //   }
  // eslint-disable-next-line global-require
  const allAddresses: { [network: string]: string[] } = require('./ambireAddresses.json')
  const finalObject = await Promise.all(
    Object.entries(allAddresses).map(async ([network, addresses]) => [
      network,
      await Promise.all(
        addresses.map(async (address) => [address, await getLatestuserTxns(network, address)])
      ).then(Object.fromEntries)
    ])
  ).then(Object.fromEntries)
  console.log(stringify(finalObject))
  //   console.log(Object.fromEntries(txns).ethereum)
}
// getAllAddresses()=>console.logs {[network:string]:address[]}
// getAllNeededData()

function getAccountOpForTxn(accountAddr: string, networkId: string, _calls: any): AccountOp | null {
  if (!_calls || !_calls.length) return null
  const calls = _calls.map((call: any[]) => ({ to: call[0], value: call[1], data: call[2] }))
  return {
    accountAddr,
    networkId,
    calls,
    humanizerMeta: {}, // { [key: string]: any }
    signingKeyAddr: null,
    signingKeyType: null,
    nonce: null,
    gasLimit: null,
    signature: null,
    gasFeePayment: null,
    accountOpToExecuteBefore: null
  }
}
async function testHumanizer() {
  const storage = produceMemoryStore()
  await storage.set('HumanizerMeta', humanizerJSON)
  //   accountOp.humanizerMeta = humanizerJSON
  // eslint-disable-next-line global-require
  const allData: any = parse(stringify(require('./data.json')))
  //   remove arbitrum
  delete allData.arbitrum

  const accountOps = Object.entries(allData)
    .map(([network, addresses]: [string, any]): AccountOp[] =>
      Object.entries(addresses)
        .map(([address, txns]: [string, any]): AccountOp[] =>
          txns.map((txn: any) => getAccountOpForTxn(address, network, txn))
        )
        .flat()
    )
    .flat()
    .filter((x) => x)

  const emitError = (_arg: any) => null // console.log
  const res = await Promise.all(
    accountOps.map(async (accountOp): Promise<any[]> => {
      let humanized: any = []
      const onUpdate = (irCalls: IrCall[]) => {
        humanized = irCalls
      }
      await callsHumanizer(accountOp, {}, storage, fetch, onUpdate, emitError)
      return humanized
    })
  )
  const textifications = res.map((irCalls: IrCall[]) =>
    irCalls.map((call: IrCall) => visualizationToText(call, emitError))
  )
  console.log(JSON.stringify(textifications, null, 4))
}

testHumanizer()
