import { Wallet, Contract, keccak256, AbiCoder, getBytes, JsonRpcProvider } from 'ethers'
import fetch from 'node-fetch'
import { wrapEthSign } from '../ambireSign'
import AMBIRE_ACCOUNT from '../../contracts/compiled/AmbireAccount.json'
import ENTRY_POINT_ABI from './ENTRY_POINT.json'

const abiCoder = new AbiCoder()

const AMBIRE_ACCOUNT_ADDR = '0xD1cE5E6AE56693D2D3D52b2EBDf969C1D7901971'
const SIGNER_PRIV_KEY = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'

const polygonUrl = 'https://rpc.ankr.com/polygon'
const polygonChainId = 137
const provider = new JsonRpcProvider(polygonUrl)

const ENTRY_POINT_ADDR = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'

const txn = ['0xC2E6dFcc2C6722866aD65F211D5757e1D2879337', 10000000000000000n, '0x']

const apiKey = 'c6eabeca-dd7c-49b5-afa6-50ff36cfc5be'
const pimlicoEndpoint = `https://api.pimlico.io/v1/polygon/rpc?apikey=${apiKey}`
const pimlicoProvider = new JsonRpcProvider(pimlicoEndpoint)

async function test() {
  const signer = new Wallet(SIGNER_PRIV_KEY)
  const ambireAccount = new Contract(AMBIRE_ACCOUNT_ADDR, AMBIRE_ACCOUNT.abi, provider)
  const nonce = await ambireAccount.nonce()
  const entryPoint = new Contract(ENTRY_POINT_ADDR, ENTRY_POINT_ABI, provider)

  const hash = keccak256(
    abiCoder.encode(
      ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
      [signer.address, polygonChainId, nonce, [txn]]
    )
  )

  const s = wrapEthSign(await signer.signMessage(getBytes(hash)))
  const callData = ambireAccount.interface.encodeFunctionData('execute', [[txn], s])

  const newNonce = await entryPoint.getNonce(...[AMBIRE_ACCOUNT_ADDR, 0])
  const gasPrice = 200000000000

  function hexlify(x: number) {
    return `0x${x.toString(16)}`
  }

  const userOperation = {
    sender: AMBIRE_ACCOUNT_ADDR,
    nonce: hexlify(newNonce),
    initCode: '0x',
    callData,
    callGasLimit: hexlify(100000), // hardcode it for now at a high value
    verificationGasLimit: hexlify(500000), // hardcode it for now at a high value
    preVerificationGas: hexlify(50000), // hardcode it for now at a high value
    maxFeePerGas: hexlify(gasPrice),
    maxPriorityFeePerGas: hexlify(gasPrice),
    paymasterAndData: '0x0000000000000000000000000000000000000000',
    signature: '0x'
  }

  const args = [userOperation, ENTRY_POINT_ADDR]
  console.log({ args })

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

  const signature = await signer.signMessage(
    getBytes(await entryPoint.getUserOpHash(userOperation))
  )

  userOperation.signature = signature

  options.body = JSON.stringify({
    id: 1,
    jsonrpc: '2.0',
    method: 'eth_sendUserOperation',
    params: [userOperation, ENTRY_POINT_ADDR]
  })

  console.log({ options })

  const userOperationHash = await fetch(pimlicoEndpoint, options)
    .then((response) => {
      console.log(response)
      return response.json()
    })
    .then((response) => {
      return response
    })
    .catch((err) => console.error(err))

  console.log({ userOperationHash })

  // const sponsorUserOperationResult = await pimlicoProvider
  //   .send('pm_sponsorUserOperation', args)
  //   .catch((e) => console.log({ e }))

  // console.log({ sponsorUserOperationResult })
}

test()
