//
// Copyright © 2024 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

const fs = require('fs')
const path = require('path')
const exec = require('child_process').exec

// Auraplex: without git or tags (ZIP download, shallow clone, no .git in the build)
// use version.txt instead of the old "0.6.0" default, so front and server always agree.
function fromFile () {
  try {
    return fs.readFileSync(path.resolve(__dirname, 'version.txt'), 'utf8').trim()
  } catch {
    return '"0.6.0"'
  }
}

exec('git describe --tags --abbrev=0', (err, stdout, stderr) => {
  if (err !== null) {
    console.log(fromFile())
    return
  }
  const rawVersion = stdout.trim().replace('v', '').replace('s', '').split('.')
  if (rawVersion.length === 3) {
    const version = {
      major: parseInt(rawVersion[0]),
      minor: parseInt(rawVersion[1]),
      patch: parseInt(rawVersion[2])
    }
    console.log(`"${version.major}.${version.minor}.${version.patch}"`)
  } else {
    console.log(fromFile())
  }
})
