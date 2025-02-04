import { Calls, UserRequest } from '../../interfaces/userRequest';
export interface Call {
    to: string;
    value: bigint;
    data: string;
    fromUserRequestId?: UserRequest['id'];
    id?: Calls['calls'][number]['id'];
}
//# sourceMappingURL=types.d.ts.map