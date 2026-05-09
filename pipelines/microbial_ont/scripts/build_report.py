#!/usr/bin/env python3
"""
build_report.py — collapse all per-tool outputs into a single structured
report.json plus a human-readable report.md. Designed to be cheap, deterministic,
and easy for the BioAgents agent to parse.

Usage:
    build_report.py --sample SID --inputs '<json>' --out-json X --out-md Y
"""
import argparse, json, os, sys, csv
from pathlib import Path
import pandas as pd


def safe_read_tsv(p):
    p = Path(p)
    if not p.exists() or p.stat().st_size == 0:
        return pd.DataFrame()
    try:
        return pd.read_csv(p, sep="\t")
    except Exception:
        return pd.DataFrame()


def parse_nanostats(p):
    out = {}
    p = Path(p)
    if not p.exists():
        return out
    for line in p.read_text().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def parse_flye_info(p):
    df = safe_read_tsv(p)
    if df.empty:
        return {"contigs": []}
    contigs = df.to_dict(orient="records")
    return {
        "n_contigs": len(contigs),
        "total_length": int(df["length"].sum()) if "length" in df else None,
        "contigs": contigs[:50],
    }


def parse_checkm2(p):
    df = safe_read_tsv(p)
    if df.empty:
        return {}
    row = df.iloc[0].to_dict()
    return {
        "completeness": row.get("Completeness"),
        "contamination": row.get("Contamination"),
        "genome_size": row.get("Genome_Size"),
        "n50": row.get("N50"),
        "coding_density": row.get("Coding_Density"),
    }


def parse_quast(p):
    df = safe_read_tsv(p)
    if df.empty:
        return {}
    return {r["Assembly"] if "Assembly" in r else "stat": r.iloc[1] for _, r in df.iterrows()}


def parse_sourmash(p):
    p = Path(p)
    if not p.exists() or p.stat().st_size == 0:
        return []
    try:
        df = pd.read_csv(p)
    except Exception:
        return []
    cols = [c for c in ["f_unique_to_query", "f_match", "name", "lineage"] if c in df.columns]
    return df[cols].head(10).to_dict(orient="records") if cols else []


def parse_skani(p):
    df = safe_read_tsv(p)
    if df.empty:
        return []
    keep = [c for c in ["Ref_file", "ANI", "Align_fraction_query", "Ref_name"] if c in df.columns]
    return df[keep].head(10).to_dict(orient="records") if keep else []


def parse_bakta_tsv(p):
    df = safe_read_tsv(p)
    if df.empty:
        return {}
    by_type = df["Type"].value_counts().to_dict() if "Type" in df else {}
    return {"feature_counts": by_type, "total_features": int(len(df))}


def parse_amrfinder(p):
    df = safe_read_tsv(p)
    if df.empty:
        return {"hits": []}
    return {
        "hit_count": int(len(df)),
        "hits": df.head(50).to_dict(orient="records"),
    }


def parse_abricate(p):
    df = safe_read_tsv(p)
    if df.empty:
        return {"hits": []}
    keep = [c for c in ["GENE", "%COVERAGE", "%IDENTITY", "PRODUCT", "RESISTANCE"] if c in df.columns]
    return {"hit_count": int(len(df)), "hits": df[keep].head(50).to_dict(orient="records") if keep else []}


def parse_mefinder(p):
    p = Path(p)
    if not p.exists() or p.stat().st_size == 0:
        return {"hits": []}
    try:
        df = pd.read_csv(p)
    except Exception:
        return {"hits": []}
    return {"hit_count": int(len(df)), "hits": df.head(50).to_dict(orient="records")}


def parse_islands(p):
    p = Path(p)
    if not p.exists() or p.stat().st_size == 0:
        return {"island_count": 0, "islands": []}
    rows = []
    for line in p.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        f = line.split("\t")
        if len(f) >= 5:
            rows.append({"contig": f[0], "start": int(f[3]), "end": int(f[4])})
    return {"island_count": len(rows), "islands": rows[:50]}


def parse_gapseq(pathways_p, rxns_p):
    p = safe_read_tsv(pathways_p)
    r = safe_read_tsv(rxns_p)
    out = {}
    if not p.empty:
        # gapseq columns: Prediction, Pathway, Name, ...
        present = p[p.get("Prediction", "").astype(str).str.lower() == "true"]
        out["pathways_present"] = int(len(present))
        out["pathways_total"] = int(len(p))
        keep = [c for c in ["ID", "Name", "Prediction", "Completeness"] if c in p.columns]
        out["top_pathways"] = present[keep].head(40).to_dict(orient="records") if keep else []
    if not r.empty:
        out["reactions_total"] = int(len(r))
    return out


def parse_antismash(p):
    p = Path(p)
    if not p.exists():
        return {"clusters": []}
    try:
        data = json.loads(p.read_text())
    except Exception:
        return {"clusters": []}
    clusters = []
    for record in data.get("records", []):
        for area in record.get("areas", []):
            clusters.append({
                "type": area.get("products"),
                "start": area.get("start"),
                "end": area.get("end"),
                "contig": record.get("id"),
            })
    return {"cluster_count": len(clusters), "clusters": clusters[:50]}


def parse_targeted(p):
    """hmmsearch --tblout output."""
    p = Path(p)
    if not p.exists():
        return {"hits": []}
    hits = []
    for line in p.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        f = line.split()
        if len(f) >= 6:
            hits.append({"target": f[0], "query": f[2], "evalue": f[4], "score": f[5]})
    return {"hit_count": len(hits), "hits": hits[:200]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", required=True)
    ap.add_argument("--inputs", required=True, help="JSON dict of input paths")
    ap.add_argument("--out-json", required=True)
    ap.add_argument("--out-md", required=True)
    args = ap.parse_args()

    inp = json.loads(args.inputs)
    rep = {
        "schema_version": 1,
        "sample": args.sample,
        "qc": {
            "raw":      parse_nanostats(inp["nanoplot_raw"]),
            "filtered": parse_nanostats(inp["nanoplot_filtered"]),
        },
        "assembly":     parse_flye_info(inp["flye_info"]),
        "assembly_qc": {
            "checkm2": parse_checkm2(inp["checkm2"]),
            "quast":   parse_quast(inp["quast"]),
        },
        "taxonomy": {
            "sourmash_gather": parse_sourmash(inp["sourmash"]),
            "skani":           parse_skani(inp["skani"]),
        },
        "annotation": parse_bakta_tsv(inp["bakta_tsv"]),
        "safety": {
            "amr":            parse_amrfinder(inp["amrfinder"]),
            "virulence_vfdb": parse_abricate(inp["vfdb"]),
            "plasmids":       parse_abricate(inp["plasmid"]),
            "mobile_elements":parse_mefinder(inp["mefinder"]),
            "islands":        parse_islands(inp["islands"]),
        },
        "metabolism": {
            "gapseq":   parse_gapseq(inp["gapseq_pathways"], inp["gapseq_rxns"]),
            "sbml":     str(inp["sbml"]),
            "targeted": parse_targeted(inp["targeted"]),
        },
        "secondary_metabolites": parse_antismash(inp["antismash"]),
        "files": inp,
    }

    Path(args.out_json).write_text(json.dumps(rep, indent=2, default=str))

    # Minimal markdown view; the BioAgents agent will produce the rich narrative.
    md = []
    md.append(f"# Microbial ONT report — {args.sample}\n")
    a  = rep["assembly_qc"]["checkm2"]
    md.append(f"**CheckM2**: completeness {a.get('completeness')}, contamination {a.get('contamination')}, genome size {a.get('genome_size')} bp\n")
    sk = rep["taxonomy"]["skani"]
    if sk:
        top = sk[0]
        md.append(f"**Closest reference (skani)**: {top.get('Ref_name', top.get('Ref_file'))} — ANI {top.get('ANI')}, aligned fraction {top.get('Align_fraction_query')}\n")
    md.append(f"**AMR hits**: {rep['safety']['amr']['hit_count'] if 'hit_count' in rep['safety']['amr'] else 0}\n")
    md.append(f"**VFDB hits**: {rep['safety']['virulence_vfdb'].get('hit_count', 0)}\n")
    md.append(f"**Plasmid hits**: {rep['safety']['plasmids'].get('hit_count', 0)}\n")
    md.append(f"**Mobile elements**: {rep['safety']['mobile_elements'].get('hit_count', 0)}\n")
    md.append(f"**Genomic islands**: {rep['safety']['islands']['island_count']}\n")
    md.append(f"**gapseq pathways present**: {rep['metabolism']['gapseq'].get('pathways_present', 0)} / {rep['metabolism']['gapseq'].get('pathways_total', 0)}\n")
    md.append(f"**antiSMASH BGCs**: {rep['secondary_metabolites'].get('cluster_count', 0)}\n")
    md.append(f"**Targeted HMM hits**: {rep['metabolism']['targeted'].get('hit_count', 0)}\n")
    Path(args.out_md).write_text("\n".join(md))


if __name__ == "__main__":
    main()
