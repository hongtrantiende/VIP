# Contributing to VIP

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Start the dev server:
   ```bash
   pnpm dev
   ```
4. Create a branch for your changes:
   ```bash
   git checkout -b feat/your-feature
   ```

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/). All commits must follow this format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, missing semicolons, etc. (no code change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or correcting tests |
| `build` | Changes to build system or dependencies |
| `ci` | Changes to CI configuration |
| `chore` | Other changes that don't modify src or test files |
| `revert` | Reverts a previous commit |

### Examples

```
feat: add TTS speed control slider
fix: prevent duplicate chapters on bulk import
docs: update AI provider setup instructions
refactor(analysis): extract token budget logic
```

Commits are validated by commitlint via a Husky pre-commit hook. If your commit message doesn't conform, the commit will be rejected.

## Pull Request Process

1. Ensure your code passes linting:
   ```bash
   pnpm lint
   ```
2. Ensure the project builds:
   ```bash
   pnpm build
   ```
3. Keep PRs focused — one feature or fix per PR.
4. Write a clear PR description explaining **what** changed and **why**.
5. Link related issues if applicable.

## Code Guidelines

### General

- TypeScript strict mode is enforced — no `any` without an eslint-disable comment.
- Use `@/*` path aliases for all imports.
- UI text must be in Vietnamese (`lang="vi"`).

### Data Layer

- All database access goes through hooks in `lib/hooks/use-*.ts`.
- Mutations must set `createdAt`/`updatedAt` and use `crypto.randomUUID()` for IDs.
- Cascading deletes must use Dexie transactions.

### Components

- shadcn/ui components live in `components/ui/` — don't modify them directly, customize via props or wrapper components.
- Zustand stores in `lib/stores/` are for ephemeral UI state only — never persist to IndexedDB from a store.

### AI Integration

- All AI model resolution goes through `lib/ai/provider.ts` (`getModel`) or `lib/ai/resolve-step.ts` (`resolveStep`).
- WebGPU is chat-only — pipeline/analysis code must guard against it.
- Prompts for analysis and writing are in Vietnamese.

### Next.js 16

This project runs Next.js 16, which has breaking changes from earlier versions. Read the relevant docs in `node_modules/next/dist/docs/` before using unfamiliar APIs.

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests.
- Include browser, OS, and reproduction steps for bugs.
- For data-related bugs, note the Dexie schema version (currently v11).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
