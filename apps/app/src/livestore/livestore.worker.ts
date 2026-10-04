import { workerScriptStart } from "./worker-boot-start";
import { makeWorker } from "@livestore/adapter-web/worker";
import { schema } from "./schema";
import { reportWorkerBoot } from "./worker-boot-telemetry";

reportWorkerBoot(workerScriptStart);
makeWorker({ schema });
