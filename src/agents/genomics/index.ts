/**
 * Genomics agent — public surface used by routes / planner.
 *
 * This agent is intentionally thin. The Snakemake pipeline does the work;
 * we (a) launch it, (b) poll it, (c) hand the structured report to the LLM
 * to write a narrative. This mirrors the design rationale documented in
 * the README under "Genomics agent".
 */
export { startRun, getStatus, loadReport } from "./runner";
export { synthesizeReport } from "./synthesize";
export type { GenomicsRunRequest, GenomicsRunStatus, GenomicsReport } from "./types";

import { startRun, getStatus, loadReport } from "./runner";
import { synthesizeReport } from "./synthesize";
import type { GenomicsRunRequest } from "./types";

/**
 * runAndReport — convenience: kick off a run, await terminal state, return
 * the LLM-written narrative plus the raw structured report.
 *
 * Long-running. For UI flows you typically want to poll getStatus() yourself
 * and call synthesizeReport(loadReport(id)!) when state === "succeeded".
 */
export async function runAndReport(req: GenomicsRunRequest, opts?: { pollMs?: number; timeoutMs?: number }) {
  const pollMs = opts?.pollMs ?? 30_000;
  const timeoutMs = opts?.timeoutMs ?? 1000 * 60 * 60 * 8; // 8h cap
  await startRun(req);

  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = getStatus(req.sampleId);
    if (s && (s.state === "succeeded" || s.state === "failed")) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const final = getStatus(req.sampleId);
  if (!final || final.state !== "succeeded") {
    throw new Error(`genomics run failed: ${JSON.stringify(final)}`);
  }
  const report = loadReport(req.sampleId);
  if (!report) throw new Error("report.json not produced");
  const narrative = await synthesizeReport(report);
  return { status: final, report, narrative };
}
