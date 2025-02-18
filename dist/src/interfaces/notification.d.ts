export interface NotificationManager {
    create: ({ title, message, icon }: {
        title: string;
        message: string;
        icon?: string;
    }) => Promise<void>;
}
//# sourceMappingURL=notification.d.ts.map