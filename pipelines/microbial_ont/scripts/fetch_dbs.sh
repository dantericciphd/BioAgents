#!/usr/bin/env bash
# fetch_dbs.sh — download all reference DBs needed by microbial_ont.
# Total disk: ~15-25 GB. Uses lightweight variants throughout.
set -euo pipefail

DB_ROOT="${BIOAGENTS_DB_ROOT:-$HOME/bioagents-dbs}"
mkdir -p "$DB_ROOT"
cd "$DB_ROOT"

echo "==> CheckM2 DB (~3 GB)"
mkdir -p checkm2 && cd checkm2
if [ ! -f uniref100.KO.1.dmnd ]; then
  conda run -n bioagents-checkm2 checkm2 database --download --path .
fi
cd ..

echo "==> Bakta light DB (~2 GB)"
if [ ! -d bakta-light/db-light ]; then
  mkdir -p bakta-light && cd bakta-light
  conda run -n bioagents-bakta bakta_db download --output . --type light
  cd ..
fi

echo "==> sourmash GTDB-rs220 k=31 (~3 GB)"
mkdir -p sourmash && cd sourmash
if [ ! -f gtdb-rs220-k31.zip ]; then
  curl -L -o gtdb-rs220-k31.zip \
    "https://farm.cse.ucdavis.edu/~ctbrown/sourmash-databases/2024-01-30/gtdb-rs220-k31.zip"
fi
cd ..

echo "==> skani GTDB representatives (~5 GB)"
mkdir -p skani && cd skani
if [ ! -d gtdb_skani_db ]; then
  curl -L -o gtdb_skani.tar.gz \
    "https://faust.compbio.cs.cmu.edu/skani/gtdb_skani_db_r220.tar.gz" || \
    echo "WARN: skani GTDB sketch URL changed; check https://github.com/bluenote-1577/skani for current location."
  tar xzf gtdb_skani.tar.gz && rm gtdb_skani.tar.gz
fi
cd ..

echo "==> AMRFinderPlus DB"
conda run -n bioagents-amrfinder amrfinder -u || true

echo "==> abricate DBs (built-in)"
conda run -n bioagents-abricate abricate --setupdb || true

echo "==> gapseq DB (~1 GB, fetched on first run)"
conda run -n bioagents-gapseq gapseq -h >/dev/null 2>&1 || true

echo
echo "Done. Reference DBs in: $DB_ROOT"
echo "Total size:"
du -sh "$DB_ROOT"
