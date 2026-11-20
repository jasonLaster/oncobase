import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Expired sign-in sessions.
crons.hourly("purge expired user sessions", { minuteUTC: 7 }, internal.cleanup.purgeExpiredSessions, {});

export default crons;
