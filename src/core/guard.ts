// Refuse to write a profile while its browser is running — otherwise the
// browser overwrites our migration on exit. macOS: match the running app by
// its process name.

export async function isRunning(processName: string): Promise<boolean> {
  // pgrep -x matches the exact executable name. Chrome's is "Google Chrome".
  const proc = Bun.spawn(["pgrep", "-x", processName], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim().length > 0;
}
