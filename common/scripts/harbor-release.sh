#!/usr/bin/env bash
# Auraplex: build all Huly images from one commit and push them to the company Harbor
# under one new tag, refusing anything that could give mixed versions.
#
#   bash common/scripts/harbor-release.sh build            # build every image from the current commit
#   bash common/scripts/harbor-release.sh check            # only run the checks, push nothing
#   bash common/scripts/harbor-release.sh push v3          # check, then push everything as :v3
#   bash common/scripts/harbor-release.sh push v3 --yes    # same, without the confirmation question
#
# Log in first (in a normal terminal): docker login <harbor host>
set -euo pipefail
cd "$(dirname "$0")/../.."

# The Harbor address stays out of this public repo: it is read from a local, git-ignored file.
REGISTRY="${HARBOR_REGISTRY:-$(tr -d '
 ' < common/scripts/harbor-registry.local 2> /dev/null || true)}"
[ -n "$REGISTRY" ] || { echo "Missing common/scripts/harbor-registry.local (one line: <harbor host>:<port>/<project>)"; exit 1; }

# local image             | name in Harbor        | rush package                         | must carry the version
IMAGES=(
  "hardcoreeng/front                front                 @hcengineering/pod-front             yes"
  "hardcoreeng/transactor           server                @hcengineering/pod-server            yes"
  "hardcoreeng/workspace            workspace             @hcengineering/pod-workspace         yes"
  "hardcoreeng/account              account               @hcengineering/pod-account           no"
  "hardcoreeng/collaborator         collaborator          @hcengineering/pod-collaborator      no"
  "hardcoreeng/preview              preview               @hcengineering/pod-preview           no"
  "hardcoreeng/whatsapp             whatsapp              @hcengineering/pod-whatsapp          no"
  "hardcoreeng/prospects-recognizer prospects-recognizer  @hcengineering/prospects-recognizer  no"
  "hardcoreeng/prospect-mail        prospect-mail         @hcengineering/prospect-mail         no"
)

red () { printf '\033[31m%s\033[0m\n' "$*"; }
green () { printf '\033[32m%s\033[0m\n' "$*"; }
fail () { red "✗ $*"; exit 1; }

COMMIT="$(git rev-parse HEAD)"
SHORT="${COMMIT:0:10}"
VERSION="$(tr -d '"\r\n ' < common/scripts/version.txt)"

build () {
  local args=()
  for line in "${IMAGES[@]}"; do
    read -r _ _ pkg _ <<< "$line"
    args+=(--to "$pkg")
  done
  echo "用提交 $SHORT（版本 $VERSION）打包全部镜像……"
  node common/scripts/install-run-rush.js docker:build -p 2 "${args[@]}" || true
  echo "打包结束。接着运行：bash common/scripts/harbor-release.sh check"
}

check () {
  local problems=0
  echo "== 检查代码 =="
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    red "✗ 有改动还没提交。镜像必须来自一个已提交的版本。"; problems=1
  else green "✓ 代码已全部提交：$SHORT"; fi
  if [ -z "$(git branch -r --contains "$COMMIT" 2>/dev/null)" ]; then
    red "✗ 这个提交还没推送到 GitHub，负责人对不上代码。先推送。"; problems=1
  else green "✓ 这个提交已在 GitHub 上"; fi
  echo "版本号（common/scripts/version.txt）：$VERSION"

  echo "== 检查镜像 =="
  for line in "${IMAGES[@]}"; do
    read -r local remote _ needs <<< "$line"
    local img="$local:$COMMIT"
    if ! docker image inspect "$img" > /dev/null 2>&1; then
      red "✗ $remote：没有用 $SHORT 打包的镜像（$img）。先运行 build。"; problems=1; continue
    fi
    if [ "$needs" = "yes" ]; then
      local found
      found="$(docker run --rm --entrypoint sh "$img" -c "grep -oE '\"0\.[0-9]+\.[0-9]{3}\"' bundle.js | tr -d '\"' | sort -u" 2> /dev/null | tr '\n' ' ')"
      if [ "$(echo "$found" | xargs)" != "$VERSION" ]; then
        red "✗ $remote：镜像里的版本是 [$(echo "$found" | xargs)]，应该只有 $VERSION"; problems=1; continue
      fi
      green "✓ $remote：用 $SHORT 打包，版本 $VERSION"
    else
      green "✓ $remote：用 $SHORT 打包"
    fi
  done
  [ "$problems" = 0 ] || fail "检查没通过，什么都没推送。"
  green "全部检查通过。"
}

push () {
  local tag="${1:-}" yes="${2:-}"
  [[ "$tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || fail "请给一个新标签，例如：push v3"
  check
  echo "== 检查 Harbor 里还没有 :$tag =="
  for line in "${IMAGES[@]}"; do
    read -r _ remote _ _ <<< "$line"
    if docker manifest inspect "$REGISTRY/$remote:$tag" > /dev/null 2>&1; then
      fail "Harbor 里已经有 $remote:$tag。标签不能重复使用，请换一个新的。"
    fi
  done
  green "✓ :$tag 是新标签"
  if [ "$yes" != "--yes" ]; then
    read -r -p "要把 ${#IMAGES[@]} 个镜像推到 $REGISTRY，标签 :$tag 吗？(y/N) " answer
    [ "$answer" = "y" ] || fail "已取消，什么都没推送。"
  fi
  for line in "${IMAGES[@]}"; do
    read -r local remote _ _ <<< "$line"
    docker tag "$local:$COMMIT" "$REGISTRY/$remote:$tag"
    echo "推送 $remote:$tag ……"
    docker push -q "$REGISTRY/$remote:$tag" > /dev/null || fail "$remote:$tag 推送失败（检查登录和权限），后面的没有推送。"
    docker manifest inspect "$REGISTRY/$remote:$tag" > /dev/null || fail "$remote:$tag 推送后在 Harbor 里找不到。"
    green "✓ $remote:$tag"
  done
  echo
  green "全部推送完成。发给负责人："
  echo "------------------------------------------------------------"
  echo "New release pushed to Harbor: tag ${tag}"
  echo "Code: GitHub commit ${SHORT}, version ${VERSION} (front and server checked: both ${VERSION})"
  echo "Images:"
  for line in "${IMAGES[@]}"; do
    read -r _ remote _ _ <<< "$line"
    echo "  $REGISTRY/$remote:$tag"
  done
  echo "Please switch ALL Huly jobs to :${tag} together, redeploy, then run"
  echo "upgrade-workspace <workspace> --force for existing workspaces."
  echo "Check: <site>/config.json should show \"VERSION\":\"${VERSION}\""
  echo "------------------------------------------------------------"
}

case "${1:-}" in
  build) build ;;
  check) check ;;
  push) push "${2:-}" "${3:-}" ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
