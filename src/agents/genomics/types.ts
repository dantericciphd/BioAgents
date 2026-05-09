/**
 * Types for the microbial ONT genomics agent.
 */

export interface GenomicsRunRequest {
  sampleId: string;
  readsPath: string;     // absolute path to ONT reads (.fastq[.gz])
  genomeSize?: string;   // Flye hint, default "5m"
  threads?: number;      // default from env
}

export interface GenomicsRunStatus {
  sampleId: string;
  state: "queued" | "running" | "succeeded" | "failed";
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  logTail?: string;
  reportPath?: string;
}

export interface GenomicsReport {
  schema_version: number;
  sample: string;
  qc: any;
  assembly: any;
  assembly_qc: any;
  taxonomy: any;
  annotation: any;
  safety: {
    amr: { hit_count?: number; hits?: any[] };
    virulence_vfdb: { hit_count?: number; hits?: any[] };
    plasmids: { hit_count?: number; hits?: any[] };
    mobile_elements: { hit_count?: number; hits?: any[] };
    islands: { island_count: number; islands: any[] };
  };
  metabolism: {
    gapseq: any;
    sbml: string;
    targeted: { hit_count?: number; hits?: any[] };
  };
  secondary_metabolites: { cluster_count?: number; clusters?: any[] };
  files: Record<string, string>;
}
