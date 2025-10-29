import { hasPluggyCredentials, pluggyClient } from "../pluggy";

export type DependencyState = "ok" | "error" | "skipped";

export interface DependencyStatus {
  status: DependencyState;
  optional?: boolean;
  message?: string;
}

export interface ReadinessSnapshot {
  healthy: boolean;
  dependencies: Record<string, DependencyStatus>;
}

export async function evaluateReadinessDependencies(): Promise<ReadinessSnapshot> {
  const dependencies: Record<string, DependencyStatus> = {};

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret === "dev-secret-change-in-production") {
    dependencies.sessionSecret = {
      status: "error",
      message: "SESSION_SECRET is not configured",
    };
  } else {
    dependencies.sessionSecret = { status: "ok" };
  }

  const pluggyConfigured = hasPluggyCredentials();
  if (!pluggyConfigured) {
    dependencies.pluggy = {
      status: "skipped",
      optional: true,
      message: "Pluggy credentials not provided",
    };
  } else if (!pluggyClient.isAvailable()) {
    dependencies.pluggy = {
      status: "error",
      optional: true,
      message: "Pluggy client not initialized",
    };
  } else {
    dependencies.pluggy = {
      status: "ok",
      optional: true,
    };
  }

  const healthy = Object.values(dependencies).every(
    (dependency) => dependency.status === "ok" || dependency.status === "skipped"
  );

  return { healthy, dependencies };
}
