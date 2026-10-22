import EventEmitter from '../eventEmitter/eventEmitter';
type DescriptorFirstHumanizationOptions<T> = {
    humanizationId: number;
    fetchDescriptor: () => Promise<T>;
    applyDescriptorHumanization: (descriptor: T, humanizationId: number) => boolean;
    applyFallbackHumanization: (humanizationId: number) => boolean;
};
export default abstract class HumanizationController extends EventEmitter {
    #private;
    protected createHumanizationId(): number;
    protected isCurrentHumanization(humanizationId: number): boolean;
    /**
     * Makes every humanization still in progress stale, so none of them is applied, and clears the
     * pending fallback. For a controller that is being destroyed.
     */
    protected stopHumanization(): void;
    protected startHumanization(onStart: (humanizationId: number) => void): number;
    protected applyDescriptorFirstHumanization<T>({ humanizationId, fetchDescriptor, applyDescriptorHumanization, applyFallbackHumanization }: DescriptorFirstHumanizationOptions<T>): Promise<void>;
}
export {};
//# sourceMappingURL=humanization.d.ts.map