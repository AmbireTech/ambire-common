import { MetaData, TokenError } from './interfaces';
export declare function paginate(input: string[] | [string, bigint[]][], limit: number): any[][];
export declare function flattenResults<T>(everything: Promise<[[string, T][], MetaData][]>[]): Promise<[[TokenError, T][], MetaData | {}]>;
//# sourceMappingURL=pagination.d.ts.map