/**
 * runner.ts — launches the Snakemake pipeline as a child process and tracks
 * its lifecycle. Designed for single-machine local use (one run at a time;
 * for concurrency, route through BullMQ via USE_JOB_QUEUE).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import logger from "../../utils/logger";
import type { GenomicsRunRequest, GenomicsRunStatus, GenomicsReport } from "./types";

const PIPELINE_DIR = process.env.GENOMICS_PIPELINE_DIR || "./pipelines/microbial_ont";
const RUNS_DIR     = process.env.GENOMICS_RUNS_DIR || path.join(PIPELINE_DIR, "runs");
const THREADS      = process.env.GENOMICS_THREADS || "8";

const tracker = new Map<string, GenomicsRunStatus>();

function configFor(req: GenomicsRunRequest): string {
  return [
    `outdir: ${RUNS_DIR}`,
    `threads: ${req.threads || THREADS}`,
    `genome_size: "${req.genomeSize || "5m"}"`,
    `dbs:`,
    `  checkm2:        ~/bioagents-dbs/checkm2/uniref100.KO.1.dmnd`,
    `  bakta_light:    ~/bioagents-dbs/bakta-light/db-light`,
    `  gtdb_sourmash:  ~/bioagents-dbs/sourmash/gtdb-rs220-k31.zip`,
    `  skani_gtdb:     ~/bioagents-dbs/skani/gtdb_skani_db`,
    `  targeted_hmms:  ${PIPELINE_DIR}/resources/targeted.hmm`,
    `samples:`,
    `  ${req.sampleId}:`,
    `    reads: ${req.readsPath}`,
    ``,
  ].join("\n");
}

export async function startRun(req: GenomicsRunRequest): Promise<GenomicsRunStatus> {
  if (!existsSync(req.readsPath)) {
    throw new Error(`reads not found: ${req.readsPath}`);
  }
  mkdirSync(RUNS_DIR, { recursive: true });
  const cfgPath = path.join(RUNS_DIR, `${req.sampleId}.config.yaml`);
  writeFileSync(cfgPath, configFor(req));

  const status: GenomicsRunStatus = {
    sampleId: req.sampleId,
    state: "running",
    startedAt: new Date().toISOString(),
  };
  tracker.set(req.sampleId, status);

  const args = [
    "--snakefile", path.join(PIPELINE_DIR, "Snakefile"),
    "--configfile", cfgPath,
    "--use-conda",
    "--conda-frontend", "mamba",
    "--cores", String(req.threads || THREADS),
    "--rerun-incomplete",
    "--keep-going",
    "--printshellcmds",
  ];
  logger.info({ args }, "[genomics] launching snakemake");

  const child: ChildProcess = spawn("snakemake", args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logPath = path.join(RUNS_DIR, `${req.sampleId}.log`);
  const tail: string[] = [];
  child.stdout?.on("data", (b) => {
    const s = b.toString();
    tail.push(s); if (tail.length > 200) tail.shift();
    writeFileSync(logPath, tail.join(""), { flag: "a" });
  });
  child.stderr?.on("data", (b) => {
    const s = b.toString();
    tail.push(s); if (tail.length > 200) tail.shift();
    writeFileSync(logPath, tail.join(""), { flag: "a" });
  });
  child.on("exit", (code) => {
    const finished = tracker.get(req.sampleId)!;
    finished.state = code === 0 ? "succeeded" : "failed";
    finished.finishedAt = new Date().toISOString();
    finished.exitCode = code ?? -1;
    finished.logTail = tail.slice(-50).join("");
    finished.reportPath = path.join(RUNS_DIR, req.sampleId, "report.json");
    tracker.set(req.sampleId, finished);
    logger.info({ status: finished }, "[genomics] run finished");
  });

  return status;
}

export function getStatus(sampleId: string): GenomicsRunStatus | undefined {
  return tracker.get(sampleId);
}

export function loadReport(sampleId: string): GenomicsReport | null {
  const p = path.join(RUNS_DIR, sampleId, "report.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as GenomicsReport;
}
