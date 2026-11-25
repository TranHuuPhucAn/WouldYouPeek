import type { ScenarioAnalysis } from "@/contracts/challenge";
export function analysisLabel(author: ScenarioAnalysis["author"]) {
  return author === "ai"
    ? "AI analysis"
    : author === "ai-assisted"
      ? "Creator analysis · AI-assisted"
      : "Creator analysis";
}
export function AnalysisNote({ analysis }: { analysis: ScenarioAnalysis }) {
  return (
    <section
      className="analysis-note"
      aria-label={analysisLabel(analysis.author)}
    >
      <span className="eyebrow">
        {analysisLabel(analysis.author).toUpperCase()} · INTERPRETATION
      </span>
      <p>{analysis.rationale}</p>
      <small>{analysis.notice}</small>
      {analysis.limitations.length > 0 && (
        <details className="analysis-limitations">
          <summary>What remains uncertain</summary>
          <ul>
            {analysis.limitations.map((value, index) => (
              <li key={index}>{value}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
