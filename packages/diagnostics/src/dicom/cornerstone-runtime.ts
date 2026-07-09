type CornerstoneCore = typeof import("@cornerstonejs/core");
type CornerstoneTools = typeof import("@cornerstonejs/tools");
type DicomWadors = typeof import("@cornerstonejs/dicom-image-loader/wadors");
type DicomWadouri = typeof import("@cornerstonejs/dicom-image-loader/wadouri");

export interface CornerstoneModules {
  core: CornerstoneCore;
  tools: CornerstoneTools;
}

const CORNERSTONE_INIT_TIMEOUT_MS = 15_000;

let cornerstoneModulesPromise: Promise<CornerstoneModules> | null = null;
let dicomWorkerRegistered = false;

function createDicomImageLoaderWorker() {
  return new Worker(new URL("./dicom-image-frame-worker.ts", import.meta.url), {
    name: "dicomImageLoader",
    type: "module",
  });
}

function maxDicomWorkers() {
  return Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 4));
}

function registerDicomImageLoader(
  core: CornerstoneCore,
  wadors: DicomWadors,
  wadouri: DicomWadouri,
) {
  wadors.register();
  wadouri.register();

  if (dicomWorkerRegistered) return;

  try {
    core.getWebWorkerManager().registerWorker(
      "dicomImageLoader",
      createDicomImageLoaderWorker,
      {
        maxWorkerInstances: maxDicomWorkers(),
      },
    );
    dicomWorkerRegistered = true;
  } catch (caught) {
    dicomWorkerRegistered = false;
    throw caught;
  }
}

function safeAddTool(tools: CornerstoneTools, ToolClass: unknown) {
  if (!ToolClass) {
    // An undefined class means the bundler dropped the export — surface it
    // instead of leaving the viewer with a blank canvas and dead tools.
    throw new Error("Cornerstone tool class missing from build");
  }
  try {
    tools.addTool(ToolClass);
  } catch {
    // Global tool registration is process-wide; repeated client mounts are fine.
  }
}

function withInitTimeout<T>(promise: Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("Cornerstone initialization timed out"));
    }, CORNERSTONE_INIT_TIMEOUT_MS);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function loadCornerstoneModules() {
  const [core, toolsIndex, toolClasses, wadors, wadouri] = await Promise.all([
    import("@cornerstonejs/core"),
    import("@cornerstonejs/tools"),
    // Rolldown leaves a handful of tool-class bindings on the root barrel
    // permanently unevaluated (cyclic-barrel code-split bug); the ./tools
    // subpath barrel evaluates them, so patch those bindings from there.
    import("@cornerstonejs/tools/tools"),
    import("@cornerstonejs/dicom-image-loader/wadors"),
    import("@cornerstonejs/dicom-image-loader/wadouri"),
  ]);
  const tools: CornerstoneTools = {
    ...toolsIndex,
    WindowLevelTool: toolsIndex.WindowLevelTool ?? toolClasses.WindowLevelTool,
    PanTool: toolsIndex.PanTool ?? toolClasses.PanTool,
    ZoomTool: toolsIndex.ZoomTool ?? toolClasses.ZoomTool,
    StackScrollTool: toolsIndex.StackScrollTool ?? toolClasses.StackScrollTool,
  };

  if (!core.isCornerstoneInitialized()) {
    core.init({
      debug: {},
      rendering: {
        renderingEngineMode: "contextPool",
        webGlContextCount: 3,
      },
    });
  }

  registerDicomImageLoader(core, wadors, wadouri);
  tools.init();
  safeAddTool(tools, tools.WindowLevelTool);
  safeAddTool(tools, tools.PanTool);
  safeAddTool(tools, tools.ZoomTool);
  safeAddTool(tools, tools.StackScrollTool);

  return { core, tools };
}

export async function ensureCornerstoneModules() {
  if (!cornerstoneModulesPromise) {
    cornerstoneModulesPromise = withInitTimeout(loadCornerstoneModules()).catch(
      (caught: unknown) => {
        cornerstoneModulesPromise = null;
        throw caught;
      },
    );
  }

  return cornerstoneModulesPromise;
}
