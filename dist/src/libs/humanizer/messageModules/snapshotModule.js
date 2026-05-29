import { getAction, getLabel } from '../utils';
export const snapshotModule = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    if (message.content.domain.name === 'snapshot' &&
        message.content.message.choice &&
        message.content.message.space) {
        return {
            fullVisualization: [
                getAction('Vote'),
                getLabel('in'),
                getLabel('Snapshot:', true),
                getLabel(message.content.message.space, true)
            ]
        };
    }
    return { fullVisualization: [] };
};
//# sourceMappingURL=snapshotModule.js.map