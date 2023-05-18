import { describe, expect, test } from '@jest/globals'
import { paginate } from './pagination'

describe('Pagination tests', () => {
	test('should create a single page because the number is below or to the limit', async () => {
        const startArray = [1,2,3]
        const result = paginate(startArray, 40)
        expect(result).toStrictEqual([startArray])

        const startArray2 = [1,2,3]
        const result2 = paginate(startArray2, 3)
        expect(result2).toStrictEqual([startArray2])
	})
    test('should create two pages because the number is above the limit', async () => {
        const startArray = [1,2,3]
        const result = paginate(startArray, 2)
        expect(result.length).toBe(2)
    })
})