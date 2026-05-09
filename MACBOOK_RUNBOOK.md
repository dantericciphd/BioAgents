# BioAgents on a 16 GB Apple Silicon MacBook — Runbook for Dante

This is the exact, step-by-step install. Estimated time: 60-90 minutes for the
framework, 2-4 hours additional for the genomics reference DBs (mostly download).

Sandbox-validated steps (the bun parts and TS were validated on Linux for you).

---

## 0. Prereqs

Install Xcode CLT and Homebrew if you don't have them:

```bash
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

## 1. Toolchain

```bash
# bun lives in its own tap
brew install oven-sh/bun/bun

# Other tools
brew install supabase/tap/supabase docker miniforge mamba git jq fnm

# Wire fnm into zsh, then install Node 23.3.0
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc
exec zsh
fnm install 23.3.0 && fnm use 23.3.0 && fnm default 23.3.0
node --version   # should print v23.3.0
```

Start Docker Desktop once so its daemon is running (required for both
`supabase start` and `antiSMASH`).

## 2. Clone your fork

```bash
mkdir -p ~/dev && cd ~/dev
git clone https://github.com/dantericciphd/BioAgents.git
cd BioAgents
git remote add upstream https://github.com/bio-xyz/BioAgents.git
```

## 3. Bun deps + local Supabase

```bash
bun install
supabase init    # accept defaults
supabase start   # launches Postgres+pgvector+Studio in Docker
# Capture the printed values: API URL, anon key, service_role key, DB URL.
```

## 4. Configure .env

```bash
cp .env.local.example .env
```

Open `.env` and:

1. Set `OPENAI_API_KEY=sk-...` (your key).
2. Paste the Supabase values printed by `supabase start` into:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`,
   `SUPABASE_FULL_URL` (the postgres:// URL).
3. `BIOAGENTS_SECRET=$(openssl rand -hex 32)` — paste output.
4. (Optional) `COHERE_API_KEY=...` and `USE_RERANKING=true` for better KNOWLEDGE retrieval.

## 5. Apply DB migrations

```bash
bun run migrate
```

You should see migrations applied in `supabase/migrations/`, including the
`pgvector` extension and the chat/research tables.

## 6. Seed KNOWLEDGE base

Drop the recommended PDFs from `docs/00_README.md` into `docs/`. They'll be
embedded automatically on first server start (one-time, ~2 minutes).

## 7. First boot

```bash
bun run build:client     # one-time
bun run dev              # API + UI on http://localhost:3000
```

Open http://localhost:3000, click into Deep Research, and ask:

> "What are the main pathways for bacterial butyrate synthesis and how would I
> tell them apart from a single isolate genome?"

You should see Planning → Literature (KNOWLEDGE) → Hypothesis → Reply fire.

---

## Genomics pipeline setup

Only do this once you've confirmed the framework above is working.

### A. Conda envs

```bash
cd ~/dev/BioAgents/pipelines/microbial_ont
mamba env create -f envs/qc.yaml
mamba env create -f envs/assembly.yaml
mamba env create -f envs/medaka.yaml
mamba env create -f envs/checkm2.yaml
mamba env create -f envs/quast.yaml
mamba env create -f envs/sourmash.yaml
mamba env create -f envs/skani.yaml
mamba env create -f envs/bakta.yaml
mamba env create -f envs/amrfinder.yaml
mamba env create -f envs/abricate.yaml
mamba env create -f envs/mefinder.yaml
mamba env create -f envs/islandpath.yaml
mamba env create -f envs/gapseq.yaml
mamba env create -f envs/hmmer.yaml
mamba env create -f envs/report.yaml
mamba install -n base -c bioconda snakemake-minimal=8 -y
```

If `medaka` fails on Apple Silicon, use the Docker fallback noted in
`envs/medaka.yaml` comments.

### B. Reference databases (~15-25 GB)

```bash
bash scripts/fetch_dbs.sh           # CheckM2, Bakta-light, sourmash GTDB, skani GTDB, AMRFinder, abricate
bash scripts/build_targeted_hmm.sh  # KOfam-derived targeted HMM
```

If any URL has changed (these vendors update yearly), the script prints a
WARN — read it, find the current URL on the tool's GitHub, and rerun.

### C. Smoke-test on public data

```bash
# ~200 MB E. coli ONT run from SRA. Choose any small isolate run.
mkdir -p ~/data && cd ~/data
prefetch ERR3953006 && fasterq-dump --split-files ERR3953006 && gzip ERR3953006*.fastq

cd ~/dev/BioAgents
snakemake --snakefile pipelines/microbial_ont/Snakefile \
  --use-conda --conda-frontend mamba \
  --cores 8 \
  --config samples="{ecoli_test: {reads: $HOME/data/ERR3953006.fastq.gz}}" \
           outdir=pipelines/microbial_ont/runs \
           genome_size=5m
```

After it completes:

```bash
cat pipelines/microbial_ont/runs/ecoli_test/report.json | jq .assembly_qc
```

### D. Use the genomics agent from BioAgents UI

In the Deep Research chat, with `CHARACTER_FILE=characters/dante-microbiome.json`,
ask:

> "Run the microbial_ont pipeline on /Users/dante/data/ERR3953006.fastq.gz with
>  sample_id ecoli_test. When it finishes, write the full report."

The agent will call `runAndReport({ sampleId, readsPath })` from
`src/agents/genomics`, poll the run, then synthesize the narrative report
referencing the KNOWLEDGE base.

---

## Troubleshooting

- **`bun run migrate` fails**: confirm `SUPABASE_FULL_URL` is the `postgresql://`
  string from `supabase status`, not the API URL.
- **`docker: command not found` in antiSMASH**: open Docker Desktop first.
- **medaka install errors on Apple Silicon**: comment out `medaka` in the
  pipeline (Flye assembly is usually good enough for a first pass) or use
  `docker run ontresearch/medaka` instead.
- **gapseq slow**: it's expected; budget ~30 min on a single bacterium.
- **OOM during Flye**: drop `--genome-size` hint or use `--meta` mode if reads
  are unexpectedly diverse.
