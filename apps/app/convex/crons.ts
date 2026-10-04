import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Expired sign-in sessions and abandoned Epic FHIR OAuth handshakes.
crons.hourly("purge expired user sessions", { minuteUTC: 7 }, internal.cleanup.purgeExpiredSessions, {});
crons.hourly("purge expired OAuth states", { minuteUTC: 37 }, internal.cleanup.purgeExpiredOAuthStates, {});

export default crons;
