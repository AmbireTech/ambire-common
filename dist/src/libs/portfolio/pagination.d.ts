import { CollectionResult, ERC721Enumerable, ERC721Innumerable, MetaData, TokenError, TokenResult } from './interfaces';
export declare function paginate(input: string[] | [string, ERC721Enumerable | ERC721Innumerable][], limit: number): any[][];
export declare function flattenResults(everything: Promise<[[string, TokenResult | CollectionResult][], MetaData][]>[]): Promise<[[TokenError, TokenResult | CollectionResult][], MetaData | {}]>;
//# sourceMappingURL=pagination.d.ts.map