/**
 * synthesize.ts — converts a structured GenomicsReport into a narrative
 * report (Markdown) using the configured LLM, with the agent's character
 * system prompt. Calls the same LLM provider used by other agents.
 */
import { LLM } from "../../llm/provider";
import character from "../../character";
import logger from "../../utils/logger";
import type { GenomicsReport } from "./types";

const SYSTEM = (character?.system ?? "") + `

You are now operating as a microbial genomics report writer. Given a structured
report.json from a Snakemake pipeline, produce a Markdown report with these sections,
in this order:

1. Headline — one paragraph: identity, key safety verdict, key metabolic verdict.
2. Sample QC and assembly — read N50, post-filter yield, contigs, longest contig,
   CheckM2 completeness/contamination, QUAST N50.
3. Taxonomy and relatedness — top sourmash gather hit, top skani ANI vs reference,
   propose closest type strain. State explicitly when ANI < 95% (likely novel species).
4. Safety signals — AMR hits (gene, class, identity), virulence factors (VFDB),
   plasmid replicons, mobile genetic elements, predicted genomic islands.
   For each finding say (a) what it is, (b) likely clinical/biological relevance,
   (c) confidence given identity/coverage.
5. Metabolism — gapseq pathways present (top 20 by completeness), pathways notably
   absent that you would expect for the taxonomy, summary of the SBML model
   (reactions, metabolites if available), targeted HMM hits grouped by SCFA / bile acid /
   neurotransmitter category.
6. Secondary metabolites — antiSMASH BGCs by type, comment on novelty potential.
7. Three concrete next experiments. Each with a one-line rationale.

Rules:
- Never invent values that aren't in the input report.
- If a section has no data, say "Not run" or "No hits".
- Cite primary literature inline only when KNOWLEDGE has provided context.
- Be conservative on safety calls; flag uncertainty explicitly.
`;

function envApiKey(provider: string): string {
  const map: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };
  const envVar = map[provider];
  if (!envVar) return "";
  return process.env[envVar] || "";
}

export async function synthesizeReport(report: GenomicsReport): Promise<string> {
  const provider =
    process.env.PAPER_GEN_LLM_PROVIDER ||
    process.env.REPLY_LLM_PROVIDER ||
    "openai";
  const model =
    process.env.PAPER_GEN_LLM_MODEL ||
    process.env.REPLY_LLM_MODEL ||
    "gpt-5.4";
  const apiKey = envApiKey(provider);
  if (!apiKey) {
    throw new Error(`${provider.toUpperCase()}_API_KEY is not configured`);
  }

  const llm = new LLM({ name: provider as any, apiKey });

  const userPrompt = [
    `Sample ID: ${report.sample}`,
    ``,
    `Structured report (JSON):`,
    "```json",
    JSON.stringify(report, null, 2).slice(0, 60_000),
    "```",
    ``,
    `Write the Markdown report following the section order in the system prompt.`,
  ].join("\n");

  logger.info(
    { provider, model, sample: report.sample },
    "[genomics] synthesizing narrative",
  );

  const response = await llm.createChatCompletion({
    model,
    messages: [
      { role: "system" as const, content: SYSTEM },
      { role: "user" as const, content: userPrompt },
    ],
    maxTokens: 6000,
  });

  return response.content;
}
