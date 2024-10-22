var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { compile } from './compile';
import { describe, expect, test } from '@jest/globals';
describe('Compile', () => {
    test('should compile a contract', () => __awaiter(void 0, void 0, void 0, function* () {
        const json = compile('AmbireAccount');
        expect(json).toHaveProperty('abi');
        expect(json).toHaveProperty('bin');
        expect(json).toHaveProperty('binRuntime');
        expect(json.abi).not.toBe(null);
        expect(json.bin).not.toBe(null);
        expect(json.binRuntime).not.toBe(null);
    }));
});
