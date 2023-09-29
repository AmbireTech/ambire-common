"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStorageSlotsFromArtifact = exports.getProxyDeployBytecode = void 0;
const abi = require('ethereumjs-abi');
const keccak256 = require('js-sha3').keccak256;
function evmPush(data) {
    if (data.length < 1)
        throw new Error('evmPush: no data');
    if (data.length > 32)
        throw new Error('evmPush: data too long');
    const opCode = data.length + 95;
    const opCodeBuf = Buffer.alloc(1);
    opCodeBuf.writeUInt8(opCode, 0);
    return Buffer.concat([opCodeBuf, data]);
}
function sstoreCode(slotNumber, keyType, key, valueType, valueBuf) {
    const buf = abi.rawEncode([keyType, valueType], [key, slotNumber]);
    const slot = keccak256(buf);
    return Buffer.concat([
        evmPush(typeof valueBuf === 'string' ? Buffer.from(valueBuf.slice(2), 'hex') : valueBuf),
        evmPush(Buffer.from(slot, 'hex')),
        Buffer.from('55', 'hex')
    ]);
}
function getProxyDeployBytecode(masterContractAddr, privLevels, opts = { privSlot: 0 }) {
    const { privSlot = 0 } = opts;
    if (privLevels.length > 3)
        throw new Error('getProxyDeployBytecode: max 3 privLevels');
    const storage = Buffer.concat(privLevels.map(({ addr, hash }) => {
        return hash !== true
            ? sstoreCode(privSlot, 'address', addr, 'bytes32', hash)
            : sstoreCode(privSlot, 'address', addr, 'bool', Buffer.from('01', 'hex'));
    }));
    const initial = Buffer.from('3d602d80', 'hex');
    // NOTE: this means we can't support offset>256
    // @TODO solve this case; this will remove the "max 3 privLevels" restriction
    const offset = storage.length + initial.length + 6; // 6 more bytes including the push added later on
    if (offset > 256)
        throw new Error('getProxyDeployBytecode: internal: offset>256');
    const initialCode = Buffer.concat([storage, initial, evmPush(Buffer.from([offset]))]);
    const masterAddrBuf = Buffer.from(masterContractAddr.slice(2).replace(/^(00)+/, ''), 'hex');
    // TO DO: check if masterAddrBuf.length actually makes sense
    if (masterAddrBuf.length > 20)
        throw new Error('invalid address');
    return `0x${initialCode.toString('hex')}3d3981f3363d3d373d3d3d363d${evmPush(masterAddrBuf).toString('hex')}5af43d82803e903d91602b57fd5bf3`;
}
exports.getProxyDeployBytecode = getProxyDeployBytecode;
function getStorageSlotsFromArtifact(buildInfo) {
    if (!buildInfo)
        return { privSlot: 0 };
    const ambireAccountArtifact = buildInfo.output.sources['contracts/AmbireAccount.sol'];
    if (!ambireAccountArtifact)
        return { privSlot: 0 };
    const identityNode = ambireAccountArtifact.ast.nodes.find((el) => el.nodeType === 'ContractDefinition' && el.name === 'AmbireAccount');
    const storageVariableNodes = identityNode.nodes.filter((n) => n.nodeType === 'VariableDeclaration' && !n.constant && n.stateVariable);
    const privSlot = storageVariableNodes.findIndex((x) => x.name === 'privileges');
    return { privSlot };
}
exports.getStorageSlotsFromArtifact = getStorageSlotsFromArtifact;
//# sourceMappingURL=deploy.js.map