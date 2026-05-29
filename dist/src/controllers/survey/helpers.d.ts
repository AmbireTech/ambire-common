import { Survey } from '../../interfaces/survey';
export declare function isValidResponseOption(r: unknown): r is NonNullable<Survey['questions'][number]['responseOptions']>[number];
export declare function isSurveyQuestion(q: unknown): Survey['questions'][number] | null;
export declare function parseSurvey(res: unknown): {
    ok: true;
    survey: Survey;
} | {
    ok: false;
    error: string;
};
//# sourceMappingURL=helpers.d.ts.map