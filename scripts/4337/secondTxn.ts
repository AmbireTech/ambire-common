import { Wallet, Contract, getBytes, JsonRpcProvider, ethers } from 'ethers'
import fetch from 'node-fetch'
import { wrapEthSign } from '../../test/ambireSign'
import AMBIRE_ACCOUNT from '../../contracts/compiled/AmbireAccount.json'
import ENTRY_POINT_ABI from './ENTRY_POINT.json'
import { StaticJsonRpcProvider } from '@ethersproject/providers'

// const AMBIRE_ACCOUNT_ADDR = '0xD1cE5E6AE56693D2D3D52b2EBDf969C1D7901971'
const SIGNER_PRIV_KEY = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'

const polygonUrl = 'https://rpc.ankr.com/polygon'
const provider = new JsonRpcProvider(polygonUrl)

const ENTRY_POINT_ADDR = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'
const SENDER_ADDR = '0x24310b87b02Be1f09c4daD8F54C916911bCD5166'

// const apiKey = 'c6eabeca-dd7c-49b5-afa6-50ff36cfc5be'
const apiKey = '2b56fcf6-7796-4a89-90ac-f80d5dcf6192'
const pimlicoEndpoint = `https://api.pimlico.io/v1/polygon/rpc?apikey=${apiKey}`
const pimlicoProvider = new StaticJsonRpcProvider(pimlicoEndpoint)

async function test() {
  const signer = new Wallet(SIGNER_PRIV_KEY)
  const ambireAccount = new Contract(SENDER_ADDR, AMBIRE_ACCOUNT.abi, provider)
  const entryPoint = new Contract(ENTRY_POINT_ADDR, ENTRY_POINT_ABI, provider)
  const anotherTxn = [SENDER_ADDR, 0, '0x68656c6c6f']
  const callData = ambireAccount.interface.encodeFunctionData('executeBySender', [[anotherTxn]])
  const gasPrice = await provider.send('eth_gasPrice', [])
  const newNonce = await entryPoint.getNonce(SENDER_ADDR, 0)

  const userOperation = {
    sender: SENDER_ADDR,
    nonce: ethers.toBeHex(newNonce, 1),
    initCode: '0x',
    callData,
    callGasLimit: ethers.toBeHex(100000), // hardcode it for now at a high value
    verificationGasLimit: ethers.toBeHex(500000), // hardcode it for now at a high value
    preVerificationGas: ethers.toBeHex(50000), // hardcode it for now at a high value
    maxFeePerGas: gasPrice,
    maxPriorityFeePerGas: gasPrice,
    paymasterAndData: '0x',
    signature: '0x'
  }

  const args = [userOperation, ENTRY_POINT_ADDR]

  const options = {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'pm_sponsorUserOperation', params: args })
  }

  const paymasterAndData = await fetch(pimlicoEndpoint, options)
    .then((response) => response.json())
    .then((response) => {
      return response.result.paymasterAndData
    })
    .catch((err) => console.error(err))

  userOperation.paymasterAndData = paymasterAndData

  const signature = wrapEthSign(await signer.signMessage(
    getBytes(await entryPoint.getUserOpHash(userOperation))
  ))
  userOperation.signature = signature

  const userOperationHash = await pimlicoProvider.send("eth_sendUserOperation", [userOperation, ENTRY_POINT_ADDR])
  console.log("UserOperation hash:", userOperationHash)

  // let's also wait for the userOperation to be included, by continually querying for the receipts
  console.log("Querying for receipts...")
  let receipt = null
  let counter = 0
  while (receipt === null) {
    try {
      await new Promise((r) => setTimeout(r, 1000)) //sleep
      counter++
      receipt = await pimlicoProvider.send("eth_getUserOperationReceipt", [userOperationHash])
      console.log(receipt)
    } catch (e) {
      console.log('error throwed, retry counter ' + counter)
    }
  }
}

test()
