import { Wallet, Contract, keccak256, AbiCoder, getBytes, JsonRpcProvider, ethers } from 'ethers'
import fetch from 'node-fetch'
import { wrapEthSign } from '../ambireSign'
import AMBIRE_ACCOUNT from '../../contracts/compiled/AmbireAccount.json'
import ENTRY_POINT_ABI from './ENTRY_POINT.json'
import { FACTORY_VALIDATE_OP, PROXY_VALIDATE_OP } from '../../src/consts/deploy'
import { getBytecode } from '../../src/libs/proxyDeploy/bytecode'
import { networks } from '../../src/consts/networks'
import { StaticJsonRpcProvider } from '@ethersproject/providers'

const salt = '0x0'
function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
    return ethers.getCreate2Address(factoryAddress, ethers.toBeHex(salt, 32), ethers.keccak256(bytecode))
}

function getDeployCalldata(bytecodeWithArgs: string) {
  const abi = ['function deploy(bytes calldata code, uint256 salt) external']
  const iface = new ethers.Interface(abi)
  return iface.encodeFunctionData('deploy', [
    bytecodeWithArgs,
    salt
  ])
}

const SIGNER_PRIV_KEY = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'

const polygonUrl = 'https://rpc.ankr.com/polygon'
const provider = new JsonRpcProvider(polygonUrl)

const ENTRY_POINT_ADDR = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'

// const txn = ['0xC2E6dFcc2C6722866aD65F211D5757e1D2879337', 100n, '0x']
const txn = ['0xC2E6dFcc2C6722866aD65F211D5757e1D2879337', 0, '0x68656c6c6f']

// const apiKey = 'c6eabeca-dd7c-49b5-afa6-50ff36cfc5be'
const apiKey = '2b56fcf6-7796-4a89-90ac-f80d5dcf6192'
const pimlicoEndpoint = `https://api.pimlico.io/v1/polygon/rpc?apikey=${apiKey}`
const pimlicoProvider = new StaticJsonRpcProvider(pimlicoEndpoint)

async function test() {
  const signer = new Wallet(SIGNER_PRIV_KEY)

  const polygon = networks.filter(network => network.id == 'polygon')[0]
  const pkAddress = ethers.computeAddress(SIGNER_PRIV_KEY)
  const priLevels = [
    {addr: ENTRY_POINT_ADDR, hash: true},
    {addr: pkAddress, hash: true},
    // {addr: ethers.computeAddress(ethers.hexlify(ethers.randomBytes(32))), hash: true},
    {addr: '0x7E13d9cC8D7d50415012c889adC2a1C5fc470b79', hash: true},
  ]
  const bytecode = await getBytecode(polygon, priLevels, PROXY_VALIDATE_OP)
  const AMBIRE_ACCOUNT_ADDR = getAmbireAccountAddress(FACTORY_VALIDATE_OP, bytecode)

  const ambireAccount = new Contract(AMBIRE_ACCOUNT_ADDR, AMBIRE_ACCOUNT.abi, provider)
  const entryPoint = new Contract(ENTRY_POINT_ADDR, ENTRY_POINT_ABI, provider)
  const callData = ambireAccount.interface.encodeFunctionData('executeBySender', [[txn]])
  const newNonce = await entryPoint.getNonce(...[AMBIRE_ACCOUNT_ADDR, 0])
  const gasPrice = await provider.send('eth_gasPrice', [])

  const code = await provider.getCode(AMBIRE_ACCOUNT_ADDR)
  const hasCode = code !== '0x'
  const initCode = hasCode
    ? '0x'
    : ethers.hexlify(ethers.concat([
        FACTORY_VALIDATE_OP,
        getDeployCalldata(bytecode)
    ]))

  const userOperation = {
    sender: AMBIRE_ACCOUNT_ADDR,
    nonce: ethers.toBeHex(newNonce, 1),
    initCode,
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
  console.log(userOperation)

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
