// this script is used to deploy the proxy, factory and paymaster
// contract via EIP-2470, singleton pattern:
// https://eips.ethereum.org/EIPS/eip-2470
import {
  BaseContract,
  getAddress,
  getCreate2Address,
  JsonRpcProvider,
  keccak256,
  Wallet
} from 'ethers'

import DeployHelper from '../../../contracts/compiled/DeployHelper.json'
import { networks } from '../../consts/networks'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'

const singletonABI = [
  {
    inputs: [
      { internalType: 'bytes', name: '_initCode', type: 'bytes' },
      { internalType: 'bytes32', name: '_salt', type: 'bytes32' }
    ],
    name: 'deploy',
    outputs: [{ internalType: 'address payable', name: 'createdContract', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]

require('dotenv').config()

export async function deploy(network: NetworkDescriptor) {
  const bytecode = DeployHelper.bin
  const salt = '0x0000000000000000000000000000000000000000000000000000000000000000'
  const singletonAddr = '0xce0042B868300000d44A59004Da54A005ffdcf9f'

  // run a simulation, take the contract addresses and verify there's no code there
  const helperAddr = getCreate2Address(singletonAddr, salt, keccak256(bytecode))
  if (getAddress(helperAddr) !== getAddress('0x1F8D50d09C019C26518AA859b07C8888d0eB9576')) {
    throw new Error('Helper address different. Comment out this error if you think it is correct')
  }

  const provider = new JsonRpcProvider(network.rpcUrl)
  const code = await provider.getCode(helperAddr)
  if (code !== '0x') {
    throw new Error(`Code already deployed on address: ${helperAddr}`)
  }

  const pk = process.env.DEPLOY_PRIVATE_KEY!
  const wallet = new Wallet(pk, provider)
  const singletonContract: any = new BaseContract(singletonAddr, singletonABI, wallet)
  const result = await singletonContract.deploy(bytecode, salt)
  console.log(result)
}

const arbitrum = networks.find((net) => net.id === 'arbitrum')!
deploy(arbitrum)
