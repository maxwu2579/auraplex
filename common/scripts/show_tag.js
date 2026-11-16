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

// Auraplex: the version always comes from version.txt, never from git tags, so the
// front and the server built from the same code always report the same version,
// however the code was fetched (full clone, shallow clone, ZIP, no .git).
// To release a new version, change version.txt.
try {
  console.log(fs.readFileSync(path.resolve(__dirname, 'version.txt'), 'utf8').trim())
} catch {
  console.log('"0.6.0"')
}
