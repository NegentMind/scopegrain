# legacy/

This folder keeps the original local copy of the harness Scopegrain was
derived from (the copy predates the rename from TaskSystem). It is not
part of the active product.

## Contents

- `opencode/` — intact copy of the inherited directory (original agents,
  commands, skills, prompts, references, rules and configuration files).
  Its content was not modified when moved here.
- `provenance/` — provenance record. `copied-git-pointer.txt` preserves
  the original `.git` pointer, which pointed at an external gitdir
  (`../.git/modules/.opencode`) that is invalid inside this copy. The
  current Scopegrain Git history is independent (branch `develop`).

## Distribution status

This material is **not active** and **not distributed** until a review of
licenses, historical data and possible secrets is completed. Therefore:

- `legacy/opencode/` is ignored by Git in the new repository.
- No Scopegrain component (CLI, discovery, doctor, MCP) reads or loads
  this folder; `legacy` is an excluded prefix in discovery and a
  forbidden destination in configuration.
- The archive may contain instructions specific to the source project;
  they are not current Scopegrain instructions.
