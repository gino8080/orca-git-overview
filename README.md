# Git Overview

A multi-repository overview for [Orca](https://github.com/stablyai/orca): the git state of **every
repository inside the active workspace folder** in one right-sidebar panel. It is built for containers
that hold several repos without a common `.git` (for example `project/api`, `project/web`,
`project/docs`).

## How it relates to Orca's Source Control

It **complements** the native Source Control view and does not replace it (Orca's plugin API has no
extension point for that view). Use the native view to stage, commit and review one repository; use
this panel to see all the repositories of a folder at once and to move between them. It does not
stage, commit or discard anything.

## Features

- **Repositories**: branch, ahead/behind, staged / modified / untracked / conflict counts, stash, last commit. Optional "only dirty" filter.
- **Changes**: file list (flat or tree) with status letters and +/- line counts. Clicking a file opens its diff in a central tab.
- **Diff**: side-by-side diff in a single reused editor tab (`anteprima.gitdiff`), for working-tree changes, commits and file history. A native Orca diff is available too.
- **File history**: commits that touched a file, following renames.
- **Branches**: local and remote. Switch branch (never forced) and Fetch run only from an explicit button.
- **Graph**: commit graph with lanes, branch/tag chips, commit detail and per-file diff. Resizable split between list and detail.

Everything is read-only except the explicit **Switch** and **Fetch** actions.

## Requirements

- Orca `>= 1.4.248`
- `git` on `PATH`
- Repositories must have `.git` as a **directory** to open diffs in the central tab (linked worktrees, where `.git` is a file, are not supported for that feature).

## How repositories are found

The plugin looks at the active workspace: if its folder contains git repositories as direct children,
those are listed; if the workspace is itself a repository, its siblings are listed. Otherwise it falls
back to the **Container folder** setting.

## Settings

| Key | Meaning |
| --- | --- |
| `rootDir` | Absolute path of a folder whose children are git repositories (fallback only). |
| `language` | Interface language: `auto` (system language), `en` or `it`. |
| `refreshSeconds` | Automatic refresh interval; `0` = manual. |

## Security notes

The plugin runs as a `trusted-worker`: its worker has your user's access and executes `git` (and, for
the native diff, the `orca` CLI). Every request is validated: repositories must be children of the scanned
folder, file paths must be relative without `..`, commit hashes must be hexadecimal, and untracked files
cannot be read through symlinks that leave the repository. Temporary diff files are written to
`.git/orca-overview/` (ignored by git) and removed after an hour.

## Develop

```sh
orca plugin validate .
orca plugin test .          # parsers, layout, validation
orca plugin dev watch .     # load into Orca with logs
npm install && npm run typecheck
```

`orca plugin types` does not work on Orca 1.4.248, so `types/orca.d.ts` declares the few API pieces used.

## Known limitations

- Interface languages: English and Italian (`shared/i18n.ts`). Orca has no translation API for plugins, so a language change needs a panel reload.
- Workspaces with the same name and branch are ambiguous when mapping the active workspace to a folder.
- Diffs larger than 400 KB are truncated.

## License

MIT, see `LICENSE`.
