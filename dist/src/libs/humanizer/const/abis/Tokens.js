"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WETH = exports.ERC721 = exports.ERC20 = void 0;
exports.ERC20 = [
    'function name() view returns (string)',
    'function approve(address _spender, uint256 _value) returns (bool)',
    'function totalSupply() view returns (uint256)',
    'function transferFrom(address _from, address _to, uint256 _value) returns (bool)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address _owner) view returns (uint256 balance)',
    'function symbol() view returns (string)',
    'function transfer(address _to, uint256 _value) returns (bool)',
    'function allowance(address _owner, address _spender) view returns (uint256)',
    'function decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)',
    'function increaseAllowance(address spender, uint256 addedValue) returns (bool)'
];
exports.ERC721 = [
    'function BAYC_PROVENANCE() view returns (string)',
    'function MAX_APES() view returns (uint256)',
    'function REVEAL_TIMESTAMP() view returns (uint256)',
    'function apePrice() view returns (uint256)',
    'function approve(address to, uint256 tokenId)',
    'function balanceOf(address owner) view returns (uint256)',
    'function baseURI() view returns (string)',
    'function emergencySetStartingIndexBlock()',
    'function flipSaleState()',
    'function getApproved(uint256 tokenId) view returns (address)',
    'function isApprovedForAll(address owner, address operator) view returns (bool)',
    'function maxApePurchase() view returns (uint256)',
    'function mintApe(uint256 numberOfTokens) payable',
    'function name() view returns (string)',
    'function owner() view returns (address)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function renounceOwnership()',
    'function reserveApes()',
    'function safeTransferFrom(address from, address to, uint256 tokenId)',
    'function safeTransferFrom(address from, address to, uint256 tokenId, bytes _data)',
    'function saleIsActive() view returns (bool)',
    'function setApprovalForAll(address operator, bool approved)',
    'function setBaseURI(string baseURI)',
    'function setProvenanceHash(string provenanceHash)',
    'function setRevealTimestamp(uint256 revealTimeStamp)',
    'function setStartingIndex()',
    'function startingIndex() view returns (uint256)',
    'function startingIndexBlock() view returns (uint256)',
    'function supportsInterface(bytes4 interfaceId) view returns (bool)',
    'function symbol() view returns (string)',
    'function tokenByIndex(uint256 index) view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function totalSupply() view returns (uint256)',
    'function transferFrom(address from, address to, uint256 tokenId)',
    'function transferOwnership(address newOwner)',
    'function withdraw()'
];
exports.WETH = [
    'function name() view returns (string)',
    'function approve(address guy, uint256 wad) returns (bool)',
    'function totalSupply() view returns (uint256)',
    'function transferFrom(address src, address dst, uint256 wad) returns (bool)',
    'function withdraw(uint256 wad)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address) view returns (uint256)',
    'function symbol() view returns (string)',
    'function transfer(address dst, uint256 wad) returns (bool)',
    'function deposit() payable',
    'function allowance(address, address) view returns (uint256)'
];
//# sourceMappingURL=Tokens.js.map