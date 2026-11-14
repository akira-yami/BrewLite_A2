#!/usr/bin/env bash
set -euo pipefail

service_name="$1"
service_id="$2"
message="BrewLite A2 $service_name $REVISION run $GITHUB_RUN_ID/$GITHUB_RUN_ATTEMPT"

remote_revision="$(git ls-remote origin refs/heads/main | cut -f1)"
if [[ "$remote_revision" != "$REVISION" ]]; then
  echo "::error::main no longer points to $REVISION"
  exit 1
fi

queued="$(railway up --detach --json --project "$PROJECT_ID" --environment "$ENVIRONMENT_ID" \
  --service "$service_id" --message "$message")"
deployment_id="$(jq -er '.deploymentId | select(type == "string" and length > 0)' <<< "$queued")"
jq '{deploymentId, logsUrl}' <<< "$queued" > "$EVIDENCE_DIR/$service_name-queued.json"

# The upload can finish before pre-deploy migration and health checks.
for ((attempt = 1; attempt <= 150; attempt++)); do
  deployments="$(railway deployment list --project "$PROJECT_ID" --service "$service_id" \
    --environment "$ENVIRONMENT_ID" --limit 10 --json)"
  deployment="$(jq -c --arg id "$deployment_id" \
    '[.[] | select(.id == $id) | {id, status, createdAt, meta: {commitMessage: .meta.commitMessage, commitHash: .meta.commitHash}}][0] // empty' \
    <<< "$deployments")"
  if [[ -n "$deployment" ]]; then
    printf '%s\n' "$deployment" > "$EVIDENCE_DIR/$service_name-deployment.json"
    status="$(jq -r '.status' <<< "$deployment")"
    echo "$service_name deployment $(jq -r '.id' <<< "$deployment"): $status"
    case "$status" in
      SUCCESS) exit 0 ;;
      FAILED|CRASHED|REMOVED|SKIPPED)
        echo "::error::$service_name deployment ended with $status"
        exit 1 ;;
    esac
  fi
  sleep 5
done

echo "::error::Timed out awaiting $service_name deployment for $REVISION"
exit 1
