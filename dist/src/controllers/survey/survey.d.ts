import { IStorageController } from '@/interfaces/storage';
import { IUiController } from '@/interfaces/ui';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { Fetch } from '../../interfaces/fetch';
import { ISurveyController, Survey, SurveyAnswers } from '../../interfaces/survey';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const ANSWERED_SURVEYS_STORAGE_KEY = "surveysRespondedTo";
export declare class SurveyController extends EventEmitter implements ISurveyController {
    #private;
    initialLoadPromise?: Promise<void>;
    bannerId?: string | number;
    surveyId?: string;
    answers: SurveyAnswers;
    status: 'not-started' | 'loading-fetching' | 'loading-sending' | 'error-fetching' | 'error-submitting' | 'success-fetched' | 'success-submitted';
    errorMessage?: string;
    constructor({ fetch, relayerUrl, storage, eventEmitterRegistry, ui, dismissBanner }: {
        fetch: Fetch;
        relayerUrl: string;
        storage: IStorageController;
        ui: IUiController;
        eventEmitterRegistry?: IEventEmitterRegistryController;
        dismissBanner: (bannerId: string | number) => void;
    });
    get isReady(): boolean;
    isSurveyAnswered(surveyId: Survey['surveyId']): boolean;
    fetchSurvey(surveyId: Survey['surveyId'], bannerId: string | number | undefined): Promise<void>;
    sendResponse(instanceId: string, address: string): Promise<void>;
    answerQuestion(questionId: number, questionPosition: number, answer: number | string, instanceId: string, address: string): Promise<void>;
    get currentQuestion(): Survey['questions'][number] | undefined;
    clearSurveyState(): void;
    get hasPersistentState(): boolean;
    get questions(): Survey['questions'] | undefined;
    toJSON(): this & {
        isReady: boolean;
        currentQuestion: {
            id: number;
            questionPosition: number;
            requirement?: {
                questionId: number;
                responseId: number;
            };
            text: string;
            responseOptions: Array<{
                text: string;
                id: number;
            }> | null;
            responseType: "singleChoice" | "openText";
        };
        hasPersistentState: boolean;
        questions: {
            id: number;
            questionPosition: number;
            requirement?: {
                questionId: number;
                responseId: number;
            };
            text: string;
            responseOptions: Array<{
                text: string;
                id: number;
            }> | null;
            responseType: "singleChoice" | "openText";
        }[];
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=survey.d.ts.map