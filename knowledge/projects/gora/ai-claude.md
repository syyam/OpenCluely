<!-- How I used Claude (Anthropic) at Rakuten GORA: Claude Code, custom agents,
skills and MCP servers. Every profile (no profiles line). Claude was used ONLY
at Rakuten GORA, never at uPaisa, Speeqr or anywhere else. The hub entry
covers every workflow in short steps; each deep-dive entry is pulled in when
the question names that workflow (or follows up on it). Keep the hub under
~4k chars and each deep-dive under ~2.5k so hub + one deep-dive fit the 7000-char
notes cap. The GORA product's AI search assistant is a different topic
(gora-fe-ai-assistant in frontend-customer.md). -->

## Rakuten GORA — how I use Claude (Claude Code, agents, skills, MCP)
id: gora-ai-claude
include: gora-ai-verify
group: gora-ai
keys: !claude*, !anthropic, !claude code, !agentic, !ai agent*, !sub agent*, !subagent*, !multi agent*, !mcp, !model context protocol, !ai tool*, !ai assisted, !ai coding, !use ai, !using ai, !ai in your, !ai workflow*, !llm*, !slash command*, !worktree*, !pr review*, !cloud code, !claw code, !clawed, claw, cloud agent*, agent*, skill*, automat*, code review*, ai
- "Claude" here is **Anthropic's AI model and Claude Code** (its agentic coding tool), never cloud infrastructure. A voice transcript may show it as "cloud", "claw" or "clawed".
- Where: only at **Rakuten GORA**. Never say I used Claude at another company.
- Resume facts: I built **custom Claude agents and skills** for the GORA team (code review, design-to-code, HLD drafts, Jira tickets, release notes) and helped other engineers bring them into their workflow. Certificates: **Claude with the Anthropic API** (Anthropic, Apr 2026) and **Agentic AI and AI Agents** (DeepLearning.AI, May 2026).
- Answer shape: one line on how Claude fits my work. Then each workflow gets its own `###` heading with **numbered steps** (what I trigger → what Claude / the agents do → what I check) and a one-line **Why**. End with the guardrails. A broad question covers all six workflows; a question about one goes deep on that one.
- The workflows, short form:
  1. **`/verify` multi-agent PR review** (main story): I run `/verify` in the terminal → **Skip Checker** filters the diff → **Bug, Convention and Security reviewers** run in parallel with separate contexts → **Issue Validator** dedupes and grades severity → **Verify Audit** lists the blocking / major issues with file-and-line proof → I fix them, then open the PR.
  2. **Figma → code with the Figma MCP**: the designer's frame link → Claude reads the layout, tokens and a screenshot through the Figma Dev Mode MCP server → maps them onto our existing design-system components → builds the screen with loading / empty / error states → compares with the screenshot and iterates → I review and run `/verify`.
  3. **HLD drafts**: `/hld <ticket>` → reads the Jira ticket through the Atlassian MCP → sub-agents map the affected code → fills our HLD template (with a Mermaid diagram) → I correct it → Confluence draft for design review.
  4. **Jira tickets**: from an approved HLD or a bug report → epic, stories and sub-tasks with acceptance criteria → duplicate check with a JQL search → I approve the draft → created through the MCP; the team estimates.
  5. **Release notes**: merged PRs since the last release tag → grouped into features / fixes / internal, each with its Jira link → draft for the release owner.
  6. **Daily Claude Code setup**: `CLAUDE.md` project memory, hooks that run build / tests / lint after every edit, git worktrees for parallel sessions, and a test-writer sub-agent.
- Guardrails: a human reviews every diff; AI findings stay advisory until the citation checks out; reviewer agents are read-only; permission allow-lists limit what the agent can run; no secrets or customer data in prompts; nothing is created in Jira or Confluence without my approval.
- Don't invent metrics (time saved, bug counts, adoption numbers).

## GORA — `/verify`: my multi-agent PR review skill, step by step
id: gora-ai-verify
group: gora-ai
keys: !verify, !pr review*, !code review*, !pull request review*, !skip checker, !issue validator, !verify audit, !bug reviewer, !convention reviewer, !security reviewer, !multi agent*, !parallel agent*, !review agent*, !review pipeline, validator*, reviewer*, review*, pipeline, sub agent*, subagent*, parallel, cross contamination, severity, citation*
need: claude*, cloud code, claw*, clawed, ai, agent*, subagent*, mcp, llm*, verify, skill*, automat*, pipeline
- A Claude Code **skill** in the repo's `.claude/` folder, shared with the team. I trigger it by hand with `/verify` in the **Android Studio terminal** before opening a pull request on the GORA app.
- Steps:
  1. **Skip Checker agent**: reads `git diff` against the base branch and keeps only the files worth reviewing. It drops generated code, lock files, images and other non-essential assets, so each run is focused and cheap.
  2. **Three review sub-agents, spawned in parallel**, each in its **own context** so one reviewer's opinion can't bias another (no cross-contamination). They get read-only tools: they read code and search the repo, but never edit.
     - **Bug Reviewer**: functional correctness: null / empty states, error paths, lifecycle and threading issues, broken edge cases.
     - **Convention Reviewer**: architecture and naming standards, checked against the rules in our `CLAUDE.md` and style docs (layering, module boundaries, naming).
     - **Security Reviewer**: vulnerabilities: secrets in code, unsafe input handling, auth / token mistakes, sensitive data in logs.
     - Each returns structured findings: file, line, severity, evidence and a suggested fix.
  3. **Issue Validator agent**: merges the three lists, removes duplicates, grades each finding **blocking / major / minor**, and drops any finding whose cited code doesn't show the problem (false positives).
  4. **Verify Audit agent**: writes the final report of blocking and major issues, each with **technical proof**: the exact file and line citation and why it's a problem.
  5. I fix each item or dismiss it with a reason, re-run `/verify` if the change was big, then open the PR. A human reviewer still reviews it.
- The Why: specialised reviewers in parallel catch more and stay fast; separate contexts keep their judgements independent; the validator cuts noise; citations make every finding checkable instead of "the AI said so".
- No numbers: never claim a result metric (crash rate, bugs caught, time saved, % faster, adoption). Describe the outcome in words only.


## GORA — Figma to code with Claude and the Figma MCP server
id: gora-ai-figma
group: gora-ai
keys: !figma*, !design to code, !figma to code, !dev mode, !code connect, !mockup*, design system, design token*, tokens, ui design, designer*, screen*, pixel perfect
need: claude*, cloud code, claw*, clawed, ai, agent*, mcp, llm*, gora, rakuten, did you, have you, you used, your team
- Claude Code connects to Figma through the **Figma Dev Mode MCP server**, so it reads the real design data instead of guessing from a picture.
- Steps:
  1. The designer shares the Figma frame link for the screen or component.
  2. Claude pulls the **design context** through the MCP: layout and spacing, the **variables / design tokens** (colors, typography, spacing), the component names, and a screenshot of the frame.
  3. It maps them onto **our existing design system**: the GRX components and Tailwind tokens on the web, the app's existing theme and UI components on Android. **Code Connect** mappings tell it which Figma component is which code component, so it reuses components instead of creating near-duplicates, and never hard-codes a color or size that has a token.
  4. It builds the screen with the real states the design implies: loading, empty and error, plus the responsive / different-screen-size behaviour.
  5. It runs the app or preview, compares it with the Figma screenshot and fixes the differences.
  6. I review the code, check accessibility (labels, contrast, touch targets), wire it to the real data, and run `/verify` before the PR.
- The Why: a fast first draft that stays consistent with the design system. Figma is the single source of truth for tokens, and I spend my time on logic and edge cases, not on copying spacing values.
- No numbers: never claim a result metric (crash rate, bugs caught, time saved, % faster, adoption). Describe the outcome in words only.


## GORA — HLD / design docs drafted with Claude
id: gora-ai-hld
group: gora-ai
keys: !hld, !high level design, !design doc*, !technical design, !tech spec*, !architecture doc*, !confluence, documentation, docs, design review, rfc
need: claude*, cloud code, claw*, clawed, ai, agent*, mcp, llm*, skill*, automat*, gora, rakuten
- A custom **`/hld <JIRA-KEY>`** skill in Claude Code.
- Steps:
  1. Claude reads the Jira ticket (description, acceptance criteria, linked tickets) through the **Atlassian MCP server**.
  2. **Sub-agents explore the codebase** in parallel for the parts the feature touches: existing screens and modules, BFF endpoints, downstream services and events. Each returns a short summary, so the main session's context stays clean.
  3. Claude fills in **our team's HLD template**: context and problem, goals and non-goals, the proposed architecture with a **Mermaid** diagram, API contract changes, data model and events, alternatives considered, risks, rollout (feature flag, backward compatibility), test plan, and open questions.
  4. Anything it can't confirm from the ticket or the code goes under **Open questions** rather than being guessed.
  5. I correct and complete it, especially the trade-offs, then publish it to **Confluence** as a draft for the team's design review.
- The Why: engineers spend their time on the decisions, not the boilerplate, and every HLD follows the same structure, so reviews are faster.
- No numbers: never claim a result metric (crash rate, bugs caught, time saved, % faster, adoption). Describe the outcome in words only.


## GORA — creating Jira tickets with Claude
id: gora-ai-jira
group: gora-ai
keys: !jira*, !ticket*, !epic*, !user stor*, !backlog, !acceptance criteria, sprint*, task breakdown, break down, refinement, bug report*
need: claude*, cloud code, claw*, clawed, ai, agent*, mcp, llm*, skill*, automat*
- A skill that turns a plan into Jira work through the **Atlassian MCP server**.
- Steps:
  1. Input: an approved HLD, or a bug report with its evidence (crash logs, steps to reproduce).
  2. Claude breaks it into an **epic → stories → sub-tasks**. Each ticket gets a clear title, the context, **acceptance criteria**, dependencies and the HLD / Figma links; bugs get steps to reproduce, expected vs actual behaviour and the affected versions.
  3. It runs a **JQL search** first, so it links to existing tickets instead of creating duplicates.
  4. It shows me the full draft list. Nothing is created until I approve it; then it creates the tickets with the right project, labels and components and links them to the epic.
  5. The team estimates the stories in refinement; the AI doesn't estimate.
- The Why: consistent, complete tickets with testable acceptance criteria, and less manual copy-paste from the design doc into Jira.
- No numbers: never claim a result metric (crash rate, bugs caught, time saved, % faster, adoption). Describe the outcome in words only.


## GORA — release notes, other agents and my daily Claude Code setup
id: gora-ai-agents-workflow
group: gora-ai
keys: !release note*, !changelog, !claude md, !hooks, !worktree*, !slash command*, !custom command*, !test writer, !generate test*, !unit test*, !onboard*, !adoption, !roll out, !rollout, day to day, daily, workflow, setup, team, productivity
need: claude*, cloud code, claw*, clawed, ai, agent*, mcp, llm*, skill*, automat*, release note*, changelog
- **Release-notes agent** steps:
  1. Collects the PRs merged since the last release tag, through the GitHub CLI.
  2. Groups them into features, fixes and internal changes, each with its Jira link.
  3. Rewrites them for two audiences: a short user-facing summary and a detailed internal list.
  4. Hands the draft to the release owner, who edits and publishes it.
- **Test-writer sub-agent**: writes unit tests for the changed code following our existing test patterns, then runs them; I review the tests like any other code.
- **Daily Claude Code setup**:
  - **`CLAUDE.md` project memory** in the repo: architecture, module boundaries, naming rules, build and test commands. Every session and every `/verify` reviewer starts with the same context.
  - **Hooks**: build, tests and lint / type-check run after each edit, so the agent sees its own mistakes and fixes them before I look at the diff.
  - **Plan first** for bigger changes: I review the plan before any code is written.
  - **Git worktrees**: one Claude Code session per feature or bug branch, working in parallel without touching each other's files.
  - **Permissions**: an allow-list of commands; no secrets in prompts.
- **Rolling it out to the team**: the skills and commands live in the repo's `.claude/` folder, so everyone gets them with a normal pull. I demoed them to the team, wrote short usage notes, and helped teammates adapt them to their own modules.
- No numbers: never claim a result metric (crash rate, bugs caught, time saved, % faster, adoption). Describe the outcome in words only.
