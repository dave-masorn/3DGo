# Grid - Workspace Rules

## Version Bumping Rule
For EVERY single change made to the project (no matter how small), you MUST update the version timestamp in `index.html`. 

The version format is `x.y.z`:
- `x` = major change (currently fixed as '0')
- `y` = overhaul change (e.g. complete layout change / addition of new feature). Currently '1'.
- `z` = minor change (e.g. bug fixes, slight tweaks). Increment this as a 3-digit number (e.g. 025 -> 026).

**Location to update:**
In `index.html`, look for `<div id="version-stamp">` at the top of the `.glass-container`.
Update the `Deployed Ver.` text and the `Last Update:` timestamp to the current local time of your execution.

You must remember to do this proactively without being asked on EVERY user request that results in a file edit!

## Continuous Deployment Rule
The user prefers the "Straight to Live" Option 1 workflow. For EVERY single file change made to this project, you MUST automatically run the git commands to add, commit, and push the changes to GitHub (`git push -u origin main`). Do not wait for the user to ask you to push. Always deploy immediately so they can test on the live `github.io` URL.
