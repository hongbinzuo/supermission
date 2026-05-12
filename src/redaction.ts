type RedactionRule = {
  pattern: RegExp;
  replacement: string;
};

const BUILTIN_REDACTION_RULES: RedactionRule[] = [
  {
    pattern:
      /\b((?:KEY|TOKEN|SECRET|PASSWORD|[A-Z_][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)))=([^\s'"`]+)/gi,
    replacement: "$1=[REDACTED]",
  },
  {
    pattern:
      /\\(["'])((?:KEY|TOKEN|SECRET|PASSWORD|[A-Z_][A-Z0-9_-]*(?:KEY|TOKEN|SECRET|PASSWORD)))\\\1\s*:\s*\\(["'])([^\\]+?)\\\3/gi,
    replacement: "\\$1$2\\$1: \\$3[REDACTED]\\$3",
  },
  {
    pattern:
      /(["']?)((?:KEY|TOKEN|SECRET|PASSWORD|[A-Z_][A-Z0-9_-]*(?:KEY|TOKEN|SECRET|PASSWORD)))\1\s*:\s*(["'])([^"']+)\3/gi,
    replacement: "$1$2$1: $3[REDACTED]$3",
  },
  {
    pattern:
      /\b((?:x-)?api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|token):\s*[^\s'"`]+/gi,
    replacement: "$1: [REDACTED]",
  },
  {
    pattern: /\b(Authorization:\s*Bearer\s+)[^\s]+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g,
    replacement: "[REDACTED_SECRET]",
  },
  {
    pattern: /\bghp_[A-Za-z0-9_]{8,}\b/g,
    replacement: "[REDACTED_SECRET]",
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{8,}\b/g,
    replacement: "[REDACTED_SECRET]",
  },
  {
    pattern: /\bglpat-[A-Za-z0-9_-]{8,}\b/g,
    replacement: "[REDACTED_SECRET]",
  },
];

export function isValidRedactionPattern(pattern: string): boolean {
  try {
    compilePattern(pattern);
    return true;
  } catch {
    return false;
  }
}

export function redactSecrets(value: string, customPatterns: string[] = []): string {
  let redacted = value;
  for (const rule of BUILTIN_REDACTION_RULES) {
    redacted = redacted.replace(rule.pattern, rule.replacement);
  }
  for (const pattern of customPatterns) {
    redacted = redacted.replace(compilePattern(pattern), "[REDACTED]");
  }
  return redacted;
}

function compilePattern(pattern: string): RegExp {
  const parsed = parsePattern(pattern);
  return new RegExp(parsed.source, parsed.flags);
}

function parsePattern(pattern: string): { source: string; flags: string } {
  const trimmed = pattern.trim();
  if (trimmed.startsWith("/") && trimmed.length > 1) {
    const lastSlash = trimmed.lastIndexOf("/");
    if (lastSlash > 0) {
      return {
        source: trimmed.slice(1, lastSlash),
        flags: normalizeFlags(trimmed.slice(lastSlash + 1)),
      };
    }
  }
  return {
    source: trimmed,
    flags: "gi",
  };
}

function normalizeFlags(flags: string): string {
  const seen = new Set<string>();
  let normalized = "";
  for (const flag of flags) {
    if (!/[a-z]/i.test(flag)) {
      throw new Error(`invalid regex flag: ${flag}`);
    }
    if (seen.has(flag)) continue;
    seen.add(flag);
    normalized += flag;
  }
  if (!seen.has("g")) normalized += "g";
  if (!seen.has("i")) normalized += "i";
  return normalized;
}
