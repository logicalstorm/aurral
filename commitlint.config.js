export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "breaking-exclamation-required": (parsed) => {
          const footerText = `${parsed.footer || ""}\n${parsed.body || ""}`;
          const hasBreakingFooter = /BREAKING CHANGE:|BREAKING-CHANGE:/i.test(
            footerText
          );
          const hasHeaderBang = /!:/i.test(parsed.header || "");
          if (hasBreakingFooter && !hasHeaderBang) {
            return [
              false,
              "Breaking changes must include ! in the header (feat!: or feat(scope)!).",
            ];
          }
          return [true];
        },
      },
    },
  ],
  rules: {
    "type-enum": [2, "always", ["fix", "feat", "refactor", "chore", "docs"]],
    "scope-case": [2, "always", "kebab-case"],
    "subject-empty": [2, "never"],
    "breaking-exclamation-required": [2, "always"],
  },
};
