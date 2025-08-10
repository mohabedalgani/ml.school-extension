let pyodideReady: Promise<any> | null = null;

async function loadPyodideOnce() {
  if (!pyodideReady) {
    pyodideReady = (async () => {
      // Use global loaded in index.html
      // @ts-ignore
      const py = await (window as any).loadPyodide({
        stdout: (text: string) => console.log(text),
        stderr: (text: string) => console.error(text),
      });
      return py;
    })();
  }
  return pyodideReady;
}

export async function runPython(code: string, onStdout?: (text: string) => void, onStderr?: (text: string) => void) {
  const py = await loadPyodideOnce();
  // Detect common packages and load them before execution (e.g., pandas, numpy)
  const packages: string[] = [];
  if (/\bimport\s+pandas\b|\bfrom\s+pandas\s+import\b/.test(code)) packages.push('pandas');
  if (/\bimport\s+numpy\b|\bfrom\s+numpy\s+import\b/.test(code)) packages.push('numpy');
  if (packages.length) {
    try { await py.loadPackage(packages); } catch (e) { /* ignore, will raise on run */ }
  }

  let restoreStdout: any = null;
  let restoreStderr: any = null;
  try {
    if (onStdout) restoreStdout = py.setStdout({ batched: (s: string) => onStdout(s) });
    if (onStderr) restoreStderr = py.setStderr({ batched: (s: string) => onStderr(s) });
  } catch (_) {
    // Fallback: no-op
  }
  try {
    // @ts-ignore
    const result = await py.runPythonAsync(code);
    return result;
  } finally {
    try {
      if (restoreStdout) py.setStdout(restoreStdout);
      if (restoreStderr) py.setStderr(restoreStderr);
    } catch (_) {}
  }
}

export async function ensurePyodide(): Promise<void> {
  await loadPyodideOnce();
}


