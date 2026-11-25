# DevTrack

DevTrack tracks the development and delivery progress of software projects for agencies and their clients.

## GitHub

**Installation**:
The DevTrack GitHub App installed on one GitHub account or organization. It exists once, and several workspaces can share it.
_Avoid_: integration, app

**Connection**:
One workspace's link to an installation. A workspace can have several, one per installation.
_Avoid_: installation (for this meaning), integration

**Repository grant**:
A repository that a connection allows its workspace to use. A new connection starts with none.
_Avoid_: allowlist entry, permission, allowed repository

**Repository access**:
The full set of a connection's repository grants.
_Avoid_: repository grant (for the whole set), allowlist

**Project repository**:
A granted repository linked to a specific project, whose GitHub activity goes to that project.
_Avoid_: connected repo, repo link

**Disconnect**:
A workspace removing its connection. The installation and other workspaces' connections are unaffected.
_Avoid_: uninstall, remove

**Uninstall**:
Removing the app from the account or organization on GitHub. Every connection to that installation stops working, and history is kept.
_Avoid_: disconnect

**Suspend**:
GitHub pausing an installation. Every connection to it pauses until GitHub lifts the suspension.
_Avoid_: disable, disconnect
