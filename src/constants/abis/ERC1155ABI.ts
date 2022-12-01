// TODO: update the ABI if needed - safeBatchTransferFrom, balanceOfBatch, setApprovalForAll, isApprovedForAll
const ERC1155Abi: string[] = [
    'function uri(uint256 _tokenId) view returns (string memory)',
    'function balanceOf(address _owner, uint256 tokenId) view returns (uint256)',
    'function safeTransferFrom(address from, address to, uint256 tokenId)'
]
  
export default ERC1155Abi