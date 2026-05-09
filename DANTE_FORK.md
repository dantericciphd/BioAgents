# Dante's fork — what's added on top of upstream BioAgents

This fork adds three things to vanilla [bio-xyz/BioAgents](https://github.com/bio-xyz/BioAgents):

1. **`characters/dante-microbiome.json`** — a microbial-genomics-tuned character/system
   prompt for the planning, hypothesis, reflection, and reply agents.
2. **`pipelines/microbial_ont/`** — a Snakemake pipeline for ONT bacterial isolate
   assembly + characterization, designed for 16 GB MacBooks (light reference DBs).
   Steps: NanoPlot/Filtlong QC → Flye → Medaka → CheckM2 + QUAST → sourmash + skani
   taxonomy → Bakta annotation → AMRFinderPlus + VFDB + plasmidfinder + MEFinder +
   IslandPath → gapseq → antiSMASH → targeted HMM scans for SCFA / bile-acid /
   neurotransmitter genes → `report.json` + `report.md`.
3. **`src/agents/genomics/`** — a thin BioAgents agent that launches the pipeline,
   waits for it, and asks the configured LLM to synthesize a narrative report
   grounded in the KNOWLEDGE base.

## Design rationale

- The pipeline is **standalone Snakemake**, not a fully agent-native plugin, because
  the bioinformatics tools are deterministic and benefit from DAG-based reproducibility.
  The agent earns its keep at interpretation, not orchestration.
- Reference DBs default to **light variants** (Bakta-light, GTDB sourmash + skani,
  CheckM2's diamond DB) so total disk ≈ 15–25 GB instead of the ~400 GB GTDB-Tk + DRAM
  full stack.
- LLM provider is **OpenAI-only** by default in `.env.local.example`; flip the
  `*_LLM_PROVIDER` env vars to use Anthropic/Google/OpenRouter if desired. The
  `/api/chat` route is hard-wired to Anthropic SDK, so we use `/api/deep-research`
  which is provider-agnostic.

## Setup

See `MACBOOK_RUNBOOK.md`.
