import {
  AbiCoder,
  computeAddress,
  concat,
  Contract,
  getBytes,
  getCreate2Address,
  hexlify,
  Interface,
  JsonRpcProvider,
  keccak256,
  randomBytes,
  toBeHex,
  Wallet
} from 'ethers'
import fetch from 'node-fetch'

import AMBIRE_ACCOUNT from '../../contracts/compiled/AmbireAccount.json'
import { AMBIRE_ACCOUNT_FACTORY } from '../../src/consts/deploy'
import { networks } from '../../src/consts/networks'
import { getBytecode } from '../../src/libs/proxyDeploy/bytecode'
import { wrapEthSign } from '../../test/ambireSign'
import ENTRY_POINT_ABI from './ENTRY_POINT.json'

// const AMBIRE_ACCOUNT_ADDR = '0xD1cE5E6AE56693D2D3D52b2EBDf969C1D7901971'
const SIGNER_PRIV_KEY = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'

const polygonUrl = 'https://rpc.ankr.com/polygon'
const provider = new JsonRpcProvider(polygonUrl)

const ENTRY_POINT_ADDR = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'

// const apiKey = 'c6eabeca-dd7c-49b5-afa6-50ff36cfc5be'
const apiKey = '2b56fcf6-7796-4a89-90ac-f80d5dcf6192'
const pimlicoEndpoint = `https://api.pimlico.io/v1/polygon/rpc?apikey=${apiKey}`
// TODO: Consider refactoring this to:
//
// 1. If you know the network ahead of time and wish
// to avoid even a single eth_chainId call:
//
//    provider = new JsonRpcProvider(url, network, {
//      staticNetwork: network
//    });
//
//    or
//
// 2. If you want the network automatically detected,
// this will query eth_chainId only once
//
//    provider = new JsonRpcProvider(url, undefined, {
//       staticNetwork: true
//     });
const pimlicoProvider = new JsonRpcProvider(pimlicoEndpoint)
const abiCoder = new AbiCoder()

const salt = '0x0'

function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
  return getCreate2Address(factoryAddress, toBeHex(salt, 32), keccak256(bytecode))
}

function getDeployCalldata(bytecodeWithArgs: string, txns: any, sig: string) {
  const abi = [
    'function deployAndExecute(bytes calldata code, uint256 salt, tuple(address, uint256, bytes)[] calldata txns, bytes calldata signature) external returns (address)'
  ]
  const iface = new Interface(abi)
  return iface.encodeFunctionData('deployAndExecute', [bytecodeWithArgs, salt, txns, sig])
}

function getPriviledgeTxn(ambireAccountAddr: string, privAddress: string, privHash: string) {
  const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
  const iface = new Interface(setAddrPrivilegeABI)
  const calldata = iface.encodeFunctionData('setAddrPrivilege', [privAddress, privHash])
  return [ambireAccountAddr, 0, calldata]
}

async function test() {
  const signer = new Wallet(SIGNER_PRIV_KEY)
  const polygon = networks.find((x) => x.id === 'polygon')
  if (!polygon) throw new Error('unable to find polygon network in consts')
  const secondKeyAddr = computeAddress(hexlify(randomBytes(32)))
  const privs = [
    { addr: signer.address, hash: true },
    { addr: secondKeyAddr, hash: true }
  ]
  console.log(signer.address)
  console.log(secondKeyAddr)
  const bytecodeWithArgs = await getBytecode(privs)
  const senderAddress = getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecodeWithArgs)

  const ambireAccount = new Contract(senderAddress, AMBIRE_ACCOUNT.abi, provider)
  const entryPoint = new Contract(ENTRY_POINT_ADDR, ENTRY_POINT_ABI, provider)
  const anotherTxn = [senderAddress, 0, '0x68656c6c6f']
  const callData = ambireAccount.interface.encodeFunctionData('executeBySender', [[anotherTxn]])
  const txn = getPriviledgeTxn(
    senderAddress,
    ENTRY_POINT_ADDR,
    '0x42144640c7cb5ff8aa9595ae175ffcb6dd152db6e737c13cc2d5d07576967020'
  )
  const gasPrice = await provider.send('eth_gasPrice', [])
  const msg = getBytes(
    keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [senderAddress, polygon.chainId, 0, [txn]]
      )
    )
  )
  const s = wrapEthSign(await signer.signMessage(msg))
  const initCode = hexlify(
    concat([AMBIRE_ACCOUNT_FACTORY, getDeployCalldata(bytecodeWithArgs, [txn], s)])
  )

  const userOperation = {
    sender: senderAddress,
    nonce: toBeHex(0, 1),
    initCode,
    callData,
    callGasLimit: toBeHex(100000), // hardcode it for now at a high value
    verificationGasLimit: toBeHex(500000), // hardcode it for now at a high value
    preVerificationGas: toBeHex(50000), // hardcode it for now at a high value
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

  const signature = wrapEthSign(
    await signer.signMessage(getBytes(await entryPoint.getUserOpHash(userOperation)))
  )
  userOperation.signature = signature

  const userOperationHash = await pimlicoProvider.send('eth_sendUserOperation', [
    userOperation,
    ENTRY_POINT_ADDR
  ])
  console.log('UserOperation hash:', userOperationHash)

  // let's also wait for the userOperation to be included, by continually querying for the receipts
  console.log('Querying for receipts...')
  let receipt = null
  let counter = 0
  while (receipt === null) {
    try {
      await new Promise((r) => setTimeout(r, 1000)) // sleep
      counter++
      receipt = await pimlicoProvider.send('eth_getUserOperationReceipt', [userOperationHash])
      console.log(receipt)
    } catch (e) {
      console.log(`error throwed, retry counter ${counter}`)
    }
  }
}

test()
