I am continuing an existing software project in a new Google AI Studio account.

Before analyzing any files or performing any action, establish these permanent project rules:

## Project Context

This is a real client software project.

The AI environment is used only as:
- Architecture assistant
- Technical reviewer
- Documentation assistant
- Code analysis assistant

The AI environment is NOT the primary development machine.

## Workspace Rules

All project files must exist inside a dedicated isolated workspace.

Project structure:

/workspace
│
├── api/                  Backend source code (Laravel 12)
├── web/                  Frontend source code (Next.js)
├── infrastructure/       Deployment and infrastructure files
└── docs/                 Internal documentation only

## Documentation Boundary

/docs contains internal development documents:
- architecture decisions
- audits
- planning documents
- implementation checklists
- AI context documents

These files are NOT client deliverables.

They must never:
- be included in production builds
- be pushed to client Git repository
- be treated as application source code

## Git Rules

Git operations are controlled manually from my local machine.

You must never:
- initialize Git
- commit files
- push files
- modify Git configuration

Before any Git-related suggestion, provide:
1. Files that should be included
2. Files that should be excluded
3. Reasoning

## Development Execution Rules

Do not perform heavy environment operations without explicit approval.

Never automatically run:
- composer create-project
- composer install
- npm install
- npm build
- database migrations
- Docker builds
- long-running processes

First provide a plan and wait for approval.

## Technology Decisions

Confirmed stack:

Frontend:
- Next.js
- React
- TypeScript

Backend:
- Laravel 12
- PHP 8.3
- API-only architecture

Database:
- PostgreSQL
- PostGIS extension

Cache:
- Redis

Admin:
- Laravel Filament (planned Phase 6)

Authentication:
- OTP based authentication
- Laravel Sanctum Bearer Tokens

Architecture:
- Monorepo structure:
  /api
  /web
  /infrastructure
  /docs

## Current Project Status

Completed:
- Business requirements analysis
- System architecture documentation
- Database design planning
- API design planning
- Risk analysis
- Phase planning
- Phase 1 technical decisions
- Workspace isolation rules

Frontend:
- Next.js scaffold exists.

Backend:
- Previous Laravel scaffold became corrupted during dependency operations.
- Backend should be recreated cleanly when approved.

## Important Working Style

Do not enter endless audit loops.

For each phase:
1. Review critical risks.
2. Lock decisions.
3. Implement.
4. Test.
5. Document result.
6. Move to next phase.

Always prioritize:
- maintainability
- client delivery quality
- clean source code
- controlled Git workflow

Acknowledge these rules before processing project files.