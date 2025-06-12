import { solidityPackedKeccak256 } from 'ethers'

// @TODO: fix the any
function evmPush(data: any) {
  if (data.length < 1) throw new Error('evmPush: no data')
  if (data.length > 32) throw new Error('evmPush: data too long')
  const opCode = data.length + 95
  const opCodeBuf = Buffer.alloc(1)
  opCodeBuf.writeUInt8(opCode, 0)
  return Buffer.concat([opCodeBuf, data])
}

// @TODO: fix the any
export function privSlot(slotNumber: any, keyType: any, key: any, valueType: any) {
  return solidityPackedKeccak256([keyType, valueType], [key, slotNumber])
}

// @TODO: fix the any
function sstoreCode(slotNumber: any, keyType: any, key: any, valueType: any, valueBuf: any) {
  // @TODO why are we using valueType for the slotNumber? this has to be a hardcoded uint256 and valueType is pointless
  const slot = privSlot(slotNumber, keyType, key, valueType).slice(2)
  return Buffer.concat([
    // @ts-ignore TODO: fix mismatching types
    evmPush(typeof valueBuf === 'string' ? Buffer.from(valueBuf.slice(2), 'hex') : valueBuf),
    // @ts-ignore TODO: fix mismatching types
    evmPush(Buffer.from(slot, 'hex')),
    // @ts-ignore TODO: fix mismatching types
    Buffer.from('55', 'hex')
  ])
}

export interface PrivLevels {
  addr: string
  hash: string
}

export function getProxyDeployBytecode(
  masterContractAddr: string,
  privLevels: PrivLevels[],
  opts = { privSlot: '0' }
) {
  const slotNumber = opts.privSlot ?? 0
  if (privLevels.length > 3) throw new Error('getProxyDeployBytecode: max 3 privLevels')
  const storage = Buffer.concat(
    // @ts-ignore TODO: fix mismatching types
    privLevels.map(({ addr, hash }) => sstoreCode(slotNumber, 'uint256', addr, 'uint256', hash))
  )
  const initial = Buffer.from('3d602d80', 'hex')
  // NOTE: this means we can't support offset>256
  // @TODO solve this case; this will remove the "max 3 privLevels" restriction
  const offset = storage.length + initial.length + 6 // 6 more bytes including the push added later on
  if (offset > 256) throw new Error('getProxyDeployBytecode: internal: offset>256')
  // @ts-ignore TODO: fix mismatching types
  const initialCode = Buffer.concat([storage, initial, evmPush(Buffer.from([offset]))])
  const masterAddrBuf = Buffer.from(masterContractAddr.slice(2).replace(/^(00)+/, ''), 'hex')

  // TO DO: check if masterAddrBuf.length actually makes sense
  if (masterAddrBuf.length > 20) throw new Error('invalid address')
  return `0x${initialCode.toString('hex')}3d3981f3363d3d373d3d3d363d${evmPush(
    masterAddrBuf
  ).toString('hex')}5af43d82803e903d91602b57fd5bf3`
}

export function getStorageSlotsFromArtifact(buildInfo: any) {
  if (!buildInfo) return { privSlot: 0 }
  const ambireAccountArtifact = buildInfo.output.sources['contracts/AmbireAccount.sol']
  if (!ambireAccountArtifact) return { privSlot: 0 }
  const identityNode = ambireAccountArtifact.ast.nodes.find(
    (el: any) => el.nodeType === 'ContractDefinition' && el.name === 'AmbireAccount'
  )
  const storageVariableNodes = identityNode.nodes.filter(
    (n: any) => n.nodeType === 'VariableDeclaration' && !n.constant && n.stateVariable
  )
  const slotNumber = storageVariableNodes.findIndex((x: any) => x.name === 'privileges')

  return { privSlot: slotNumber }
}
