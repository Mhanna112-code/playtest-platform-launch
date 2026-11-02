# Resume Codex on the playtest-lite task queue (Nov 2).
# Run:  powershell -ExecutionPolicy Bypass -File C:\Users\march\Projects\playtest-lite\scripts\resume-codex.ps1

# Project folder
$ProjectPath = 'C:\Users\march\Projects\playtest-lite'
Set-Location -LiteralPath $ProjectPath

# Codex's instruction files (in the project's docs folder)
$ResumeFile = Join-Path $ProjectPath 'docs\RESUME-CODEX.md'
$QueueFile  = Join-Path $ProjectPath 'docs\CODEX-QUEUE.md'
$TaskFile   = Join-Path $ProjectPath 'docs\CODEX-TASKS.md'
$LogFile    = Join-Path $PSScriptRoot 'codex-run.log'

foreach ($f in @($ResumeFile, $QueueFile, $TaskFile)) {
    if (-not (Test-Path -LiteralPath $f)) { throw "Missing file: $f" }
}

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    throw 'Codex CLI not found on PATH.'
}

# Instructions for Codex
$Prompt = @"
Read AGENTS.md first, then:
$ResumeFile

The exact prompts for the remaining tasks are in:
$QueueFile
(Every task ever written, with a status list at the top: $TaskFile)

Work through the tasks in the queue's order:
29, 25, 27, 26, and optionally 22.
Task 29 is about never charging twice: do it first and be careful.

Everything else in CODEX-TASKS.md is done or dropped: do NOT redo 11-20, 23, 24 or 28,
and do NOT implement Task 16 (Find testers).

Respect each task's worktree, branch, test schema, build folder, tests,
docs section and commit instructions. Each worktree gets its own node_modules.
Never run anything in C:\Users\march\Projects\playtest-lite itself
(it serves the owner's local site on port 3400).
Migrations: local database only (localhost:5499), never a hosted one.

Check which tasks are already completed (look for their codex/ branches).
Do not repeat completed work.

Do not push or merge branches.
If blocked, report the blocker instead of guessing.
"@

# Log startup
"=== Started: $(Get-Date) ===" | Out-File -FilePath $LogFile -Append

# Resume Codex and capture output
codex exec resume --last $Prompt *>> $LogFile

$ExitCode = $LASTEXITCODE

# Log completion
"=== Finished: $(Get-Date), exit code: $ExitCode ===" | Out-File -FilePath $LogFile -Append

exit $ExitCode
