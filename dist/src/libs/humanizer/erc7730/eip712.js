"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEip712EncodeTypeHashFromString = exports.getEip712EncodeTypeHash = exports.getEip712EncodeType = void 0;
const ethers_1 = require("ethers");
const getBaseType = (type) => {
    let baseType = '';
    let index = 0;
    while (index < type.length) {
        const char = type[index];
        if (char !== '[') {
            baseType += char;
            index += 1;
            continue;
        }
        const closingBracketIndex = type.indexOf(']', index + 1);
        if (closingBracketIndex === -1) {
            baseType += type.slice(index);
            break;
        }
        index = closingBracketIndex + 1;
    }
    return baseType;
};
const encodeTypeFragment = (typeName, types) => {
    const fields = types[typeName];
    if (!fields)
        throw new Error(`Missing EIP-712 type ${typeName}`);
    return `${typeName}(${fields.map(({ name, type }) => `${type} ${name}`).join(',')})`;
};
const getEip712EncodeType = (types, primaryType) => {
    if (!types[primaryType])
        throw new Error(`Missing primary EIP-712 type ${primaryType}`);
    const customTypeNames = new Set(Object.keys(types).filter((typeName) => typeName !== 'EIP712Domain'));
    const dependencies = new Set();
    const collectDependencies = (typeName) => {
        const fields = types[typeName];
        if (!fields)
            return;
        fields.forEach(({ type }) => {
            const baseType = getBaseType(type);
            if (!customTypeNames.has(baseType) || dependencies.has(baseType))
                return;
            dependencies.add(baseType);
            collectDependencies(baseType);
        });
    };
    collectDependencies(primaryType);
    dependencies.delete(primaryType);
    return [primaryType, ...Array.from(dependencies).sort()]
        .map((typeName) => encodeTypeFragment(typeName, types))
        .join('');
};
exports.getEip712EncodeType = getEip712EncodeType;
const getEip712EncodeTypeHash = (types, primaryType) => (0, ethers_1.keccak256)((0, ethers_1.toUtf8Bytes)((0, exports.getEip712EncodeType)(types, primaryType))).toLowerCase();
exports.getEip712EncodeTypeHash = getEip712EncodeTypeHash;
const getEip712EncodeTypeHashFromString = (encodeType) => (0, ethers_1.keccak256)((0, ethers_1.toUtf8Bytes)(encodeType)).toLowerCase();
exports.getEip712EncodeTypeHashFromString = getEip712EncodeTypeHashFromString;
//# sourceMappingURL=eip712.js.map