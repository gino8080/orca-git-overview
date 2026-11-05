# Git Overview

Orca's Source Control shows one repository at a time. If your project is a folder with several
repositories and no common `.git` (for example `project/api`, `project/web`, `project/docs`), you
end up opening each one to find out which has pending work, which is behind its remote and which
is on the wrong branch.

This plugin puts **every repository inside the active workspace folder** in one right-sidebar panel
of [Orca](https://github.com/stablyai/orca): status at a glance, a summary ("3 with changes",
"on 2 different branches") and a single **Fetch** for all of them.

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
- `git` >= 2.24 on `PATH` (the graph uses `--end-of-options`, branch switching uses `git switch`)
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
`.orca-overview/` in the repository (excluded locally through `.git/info/exclude`, never versioned) and overwritten at every preview. Git's local exclude is not a `.gitignore`: tools that only read `.gitignore` (`npm pack`, Docker build contexts, rsync, zip) will include `.orca-overview/anteprima.gitdiff`, which holds the last diff you opened, so delete the folder before packaging a repository. It cannot live inside `.git`: Orca's file watcher ignores that folder, so an open diff tab would not refresh.

**Trust model.** The plugin assumes the *tracked content* of a repository can be hostile, not its `.git` folder. Background reads run `git` with `core.fsmonitor=false`, `color.ui=never`, no optional index locks and no external diff or textconv drivers. The explicit **Fetch** and **Switch** actions are different: they run `git` with the repository's own configuration (`core.sshCommand`, credential helpers, hooks such as `post-checkout`), exactly as if you ran them in a terminal. Do not use them on repositories whose `.git` you received from someone you do not trust.

**Windows.** The native diff needs `orca.exe` on `PATH`; without it the plugin falls back to its own preview.

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
