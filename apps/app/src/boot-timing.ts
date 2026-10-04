// main.tsx imports this first, so it evaluates before any other application
// module: the time from navigation to the first executed application script.
export const bootScriptStart = performance.now();
