declare module "node-cron" {
  export interface ScheduleOptions {
    scheduled?: boolean;
    timezone?: string;
    runOnInit?: boolean;
    name?: string;
  }

  export interface ScheduledTask {
    start(): void;
    stop(): void;
    destroy(): void;
    getStatus(): "scheduled" | "running" | "stopped";
  }

  export function schedule(
    expression: string,
    callback: (...args: unknown[]) => void,
    options?: ScheduleOptions,
  ): ScheduledTask;

  export function validate(expression: string): boolean;

  const nodeCron: {
    schedule: typeof schedule;
    validate: typeof validate;
  };

  export default nodeCron;
}
