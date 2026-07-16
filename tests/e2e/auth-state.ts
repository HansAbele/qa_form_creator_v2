import path from "node:path";

const authDirectory = path.join(process.cwd(), "playwright", ".auth");

export const ADMIN_AUTH_STATE = path.join(authDirectory, "admin.json");
export const QA_AUTH_STATE = path.join(authDirectory, "qa.json");
export const QA_ELEVATED_AUTH_STATE = path.join(authDirectory, "qa-elevated.json");
export const SUPERVISOR_AUTH_STATE = path.join(authDirectory, "supervisor.json");
