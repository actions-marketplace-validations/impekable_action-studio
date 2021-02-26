/* eslint-disable @typescript-eslint/no-explicit-any */
import twilio from 'twilio'
import * as github from '@actions/github'
import * as core from '@actions/core'

const path = '.studio.json'

type createOptions = {
  githubToken?: string
  client: twilio.Twilio
  masterFlow: string
  branch: string
  githubUsername: string
  repo: string
  owner: string
}

export async function create(options: createOptions): Promise<string> {
  const {
    repo,
    owner,
    branch,
    client,
    masterFlow,
    githubUsername,
    githubToken
  } = options

  if (!githubToken) {
    core.setFailed(
      `GITHUB_TOKEN is required but got ${process.env.GITHUB_TOKEN}`
    )
    return ''
  }

  let definition: any = {
    description: 'A New Flow',
    states: [
      {
        name: 'Trigger',
        type: 'trigger',
        transitions: [],
        properties: {
          offset: {
            x: 0,
            y: 0
          }
        }
      }
    ],
    initial_state: 'Trigger',
    flags: {
      allow_concurrent_calls: true
    }
  }

  if (masterFlow) {
    const flow = await client.studio.flows(masterFlow).fetch()
    definition = flow.definition
  }

  const flowInstance = await client.studio.flows.create({
    commitMessage: `${githubUsername} used Studio Control to create a project`,
    friendlyName: `${githubUsername} flow. (Branch: ${branch})`,
    status: 'published',
    definition
  })

  const flowJSON = flowInstance.toJSON()

  const octokit = github.getOctokit(githubToken)
  await octokit.repos.createOrUpdateFileContents({
    repo,
    owner,
    path,
    message: `${flowInstance.friendlyName} created at ${flowInstance.url} (SID: ${flowInstance.sid})`,
    content: Buffer.from(JSON.stringify(flowJSON)).toString('base64'),
    branch
  })

  return flowInstance.sid
}

export async function merge(options: createOptions): Promise<void> {
  const {repo, owner, branch, client, masterFlow, githubToken} = options

  if (!githubToken) {
    core.setFailed(
      `GITHUB_TOKEN is required but got ${process.env.GITHUB_TOKEN}`
    )
    return
  }

  const octokit = github.getOctokit(githubToken)

  const configFile = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref: branch
  })

  const studioConfig = JSON.parse(
    Buffer.from((configFile.data as any).content, 'base64').toString()
  )

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({studioConfig}))

  const {friendlyName, definition} = await client.studio
    .flows(studioConfig.sid)
    .fetch()

  const commitMessage = `Merged ${friendlyName} to master and updated .studio.json`

  const master = await client.studio.flows(masterFlow).update({
    status: 'published',
    commitMessage,
    definition
  })

  await octokit.repos.createOrUpdateFileContents({
    repo,
    owner,
    path,
    message: commitMessage,
    content: Buffer.from(JSON.stringify(master.toJSON())).toString('base64'),
    branch
  })

  // create release
  const {data} = await octokit.repos.createRelease({
    owner,
    repo,
    body: master.commitMessage,
    tag_name: `v${master.sid}`,
    name: `Release ${master.sid}`
  })

  await octokit.repos.uploadReleaseAsset({
    owner,
    repo,
    release_id: data.id,
    data: master.toJSON()
  })
}
