// Copyright 2020 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {describe, it, before, afterEach} from 'mocha';
import * as nock from 'nock';
import {GoYoshi} from '../../src/releasers/go-yoshi';
import {readFileSync} from 'fs';
import {resolve} from 'path';
import * as snapshot from 'snap-shot-it';
import * as suggester from 'code-suggester';
import * as sinon from 'sinon';

const sandbox = sinon.createSandbox();
const fixturesPath = './test/releasers/fixtures/yoshi-go';

describe('YoshiGo', () => {
  afterEach(() => {
    sandbox.restore();
  });
  describe('run', () => {
    before(() => {
      nock.disableNetConnect();
    });
    it('creates a release PR', async () => {
      // We stub the entire suggester API, asserting only that the
      // the appropriate changes are proposed:
      let expectedChanges = null;
      sandbox.replace(
        suggester,
        'createPullRequest',
        (_octokit, changes): Promise<number> => {
          expectedChanges = [...(changes as Map<string, object>)]; // Convert map to key/value pairs.
          return Promise.resolve(22);
        }
      );
      const graphql = JSON.parse(
        readFileSync(resolve(fixturesPath, 'commits.json'), 'utf8')
      );
      const req = nock('https://api.github.com')
        // Check for in progress, merged release PRs:
        .get(
          '/repos/googleapis/yoshi-go-test-repo/pulls?state=closed&per_page=100'
        )
        .reply(200, undefined)
        // Check for existing open release PRs.
        .get(
          '/repos/googleapis/yoshi-go-test-repo/pulls?state=open&per_page=100'
        )
        .reply(200, undefined)
        // fetch semver tags, this will be used to determine
        // the delta since the last release.
        .get('/repos/googleapis/yoshi-go-test-repo/tags?per_page=100')
        .reply(200, [
          {
            name: 'v0.123.4',
            commit: {
              sha: 'da6e52d956c1e35d19e75e0f2fdba439739ba364',
            },
          },
        ])
        .post('/graphql')
        .reply(200, {
          data: graphql,
        })
        // check for CHANGES.md
        .get(
          '/repos/googleapis/yoshi-go-test-repo/contents/CHANGES.md?ref=refs%2Fheads%2Fmaster'
        )
        .reply(404)
        // check for default branch
        .get('/repos/googleapis/yoshi-go-test-repo')
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        .reply(200, require('../../../test/fixtures/repo-get-1.json'))
        // create release
        .post(
          '/repos/googleapis/yoshi-go-test-repo/issues/22/labels',
          (req: {[key: string]: string}) => {
            snapshot('labels-go-yoshi', req);
            return true;
          }
        )
        .reply(200, {})
        // this step tries to close any existing PRs; just return an empty list.
        .get(
          '/repos/googleapis/yoshi-go-test-repo/pulls?state=open&per_page=100'
        )
        .reply(200, []);
      const releasePR = new GoYoshi({
        repoUrl: 'googleapis/yoshi-go-test-repo',
        releaseType: 'yoshi-go',
        // not actually used by this type of repo.
        packageName: 'yoshi-go',
        apiUrl: 'https://api.github.com',
      });
      await releasePR.run();
      req.done();
      snapshot(
        JSON.stringify(expectedChanges, null, 2).replace(
          /[0-9]{4}-[0-9]{2}-[0-9]{2}/,
          '1983-10-10' // don't save a real date, this will break tests.
        )
      );
    });
  });
});
