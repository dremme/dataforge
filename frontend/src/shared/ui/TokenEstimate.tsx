import { estimateTokens, formatCount } from "@/shared/lib/format";

interface TokenEstimateProps {
  text: string;
  className?: string;
}

export function TokenEstimate({ text, className }: TokenEstimateProps) {
  return (
    <span
      className={className}
      title="Estimated from text length; the exact count depends on the model"
    >
      ~{formatCount(estimateTokens(text))} tokens
    </span>
  );
}
