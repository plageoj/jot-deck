/**
 * Frontend half of the opt-in startup timing trace (see
 * `src-tauri/src/startup_trace.rs`). Marks are wall-clock epoch ms so they line
 * up with the Rust-side marks and with an external launcher's spawn time. The
 * Rust command ignores the report unless `JOT_DECK_STARTUP_TRACE` is set.
 */

const marks: [string, number][] = [];
let reported = false;

function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

export function markStartup(name: string): void {
  if (!marks.some(([n]) => n === name)) marks.push([name, epochNow()]);
}

/** Resolves after the next frame has actually been presented. */
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** Browser-recorded milestones, converted from timeOrigin-relative to epoch ms. */
function browserMarks(): [string, number][] {
  const origin = performance.timeOrigin;
  const out: [string, number][] = [["time_origin", origin]];
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (nav) {
    out.push(["response_end", origin + nav.responseEnd]);
    out.push(["dom_interactive", origin + nav.domInteractive]);
    out.push(["dom_content_loaded", origin + nav.domContentLoadedEventEnd]);
  }
  for (const entry of performance.getEntriesByType("paint")) {
    out.push([entry.name, origin + entry.startTime]);
  }
  return out;
}

export async function reportStartup(info: Record<string, unknown>): Promise<void> {
  if (reported || !("__TAURI_INTERNALS__" in globalThis)) return;
  reported = true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("report_startup_trace", {
      traceData: { marks: [...browserMarks(), ...marks], info },
    });
  } catch (e) {
    console.error("Failed to report startup trace:", e);
  }
}
