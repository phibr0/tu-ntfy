# TU Dortmund Exam Notifications

## How it works

- Uses your credentials to fetch exam results using the API the mobile app uses.
- Sends one notification per new/updated result to a ntfy topic.

## Quick start

1. Fork this repository.
2. In your fork, add GitHub Actions secrets:
   - `UNI_USERNAME`: your TU Dortmund username
   - `UNI_PASSWORD`: your TU Dortmund password
   - `NTFY_TOPIC`: the ntfy topic name to publish to
   - (optional) `NTFY_BASE_URL`: custom ntfy server URL (default: `https://ntfy.sh`)
   - (optional) `USER_AGENT`: override the default user agent string
3. Enable GitHub Actions in your fork.
4. The workflow runs every 15 minutes, or you can trigger it manually in the Actions tab.
