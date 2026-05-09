#!/usr/bin/env bash
# build_targeted_hmm.sh — assemble a single concatenated HMM file for the
# targeted SCFA / bile-acid / neurotransmitter scan.
#
# Strategy: pull KOfam HMMs (Aramaki et al.) for KEGG-mapped genes, plus
# selected TIGRFAM/Pfam HMMs for the curated list, into one .hmm file.
set -euo pipefail

OUT="$(dirname "$0")/../resources/targeted.hmm"
TMP="$(mktemp -d)"
echo "==> Building targeted HMM into $OUT"

# 1) Pull KOfam profiles (they ship as one tar of individual .hmm files)
if [ ! -f "$TMP/profiles.tar.gz" ]; then
  curl -L -o "$TMP/profiles.tar.gz" "https://www.genome.jp/ftp/db/kofam/profiles.tar.gz"
fi
mkdir -p "$TMP/kofam" && tar xzf "$TMP/profiles.tar.gz" -C "$TMP/kofam"

# 2) Map our targeted gene list to KO IDs (curated)
declare -A KO=(
  [ackA]=K00925 [pta]=K13788 [buk]=K00929 [bcd]=K00248 [thlA]=K00626
  [hbd]=K00074 [crt]=K01715 [mmdA]=K11264 [mmcE]=K05606
  [bsh]=K01442 [gadB]=K01580 [gadC]=K20265 [tnaA]=K01667
  [trpB]=K01696 [tyrDC]=K18933
)
PROF_DIR="$TMP/kofam/profiles"
> "$OUT"
for gene in "${!KO[@]}"; do
  ko="${KO[$gene]}"
  if [ -f "$PROF_DIR/$ko.hmm" ]; then
    sed "s|^NAME .*|NAME  ${gene}_${ko}|" "$PROF_DIR/$ko.hmm" >> "$OUT"
    echo "  + $gene ($ko)"
  else
    echo "  - missing $gene ($ko)"
  fi
done

echo "Done. Wrote $(grep -c '^NAME' "$OUT") profiles to $OUT"
echo "(For but, lcdA, baiB/CD/E/A/H, tdc, pduCDE — supply custom HMMs from"
echo " Vital et al. 2014 / Reichardt et al. 2014 / Ridlon et al. 2006 and"
echo " concatenate to $OUT.)"
