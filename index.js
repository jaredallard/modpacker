/**
 * ModPacker - a mod pack creator
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license BSD-3-Clause
 * @version 1
 */

'use strict'

const log = require('signale')
const commandLineUsage = require('command-line-usage')
const modpack = require('./lib/modpack')
const path = require('path')
const chalk = require('chalk')

const optionDefinitions = [
  { name: 'command', defaultOption: true }
]

const commandLineArgs = require('command-line-args')
const options = commandLineArgs(optionDefinitions, { stopAtFirstUnknown: true })
const commandOptions = options._unknown || []

const build = async () => {
  const optionDefinitions = [
    { name: 'modpackPath', alias: 'p', type: String },
    { name: 'output', alias: 'o', type: String }
  ]

  const options = commandLineArgs(optionDefinitions, { argv: commandOptions })

  const modpackPath = options.modpackPath || process.cwd()
  const outputPath = options.output || process.cwd()

  log.info('loading modpack at \'%s\'', modpackPath)

  let config
  try {
    config = await modpack.loadModpackConfig(path.join(modpackPath, 'modpack.yaml'))
  } catch (err) {
    log.error('Failed to load modpack.yaml: %s', err)
  }

  log.info('building Modpack %s version %s', config.name, config.version)
  const manifest = await modpack.buildModpack(config, modpackPath)

  const { newMods, removedMods } = manifest.changes
  if (newMods.length === 0 && removedMods.length === 0) {
    log.warn('No mods were removed or added, this is a no-op unless you modified configs or options')
  } else {
    log.info('%d mods were added', newMods)
  }

  if (removedMods.length !== 0) {
    log.warn('%d mods were removed from the previous release', manifest.changes.removedMods.length)
  }

  log.info('creating modpack bundles...')
  await modpack.bundleModpack(config, modpackPath, outputPath)

  log.info('modpack created')
}

const install = async () => {
  const optionDefinitions = [
    { name: 'url', type: String, defaultOption: true }
  ]

  const options = commandLineArgs(optionDefinitions, { argv: commandOptions })

  const modpackURL = options.url
  if (!modpackURL) {
    log.fatal('please provide a modpack url')
    process.exit(1)
  }

  log.info('installing modpack from %s', modpackURL)
  try {
    await modpack.installModpack(modpackURL)
  } catch (err) {
    log.fatal('failed to install modpack: %s', err)
    process.exit(1)
  }

  log.success('installed modpack')
}

const g = chalk.green
const gr = chalk.grey

const CLI_TITLE = chalk.bold.underline('modpacker')
const CLI_DESCRIPTION = 'A CLI, minecraft launcher compatible, minecraft modpack bundler and installer'
const CLI_USAGE = 'Usage: `modpacker <command> [options ...]`'

const HELP_HEADER = `
     ${g('__  ___ ')}${gr('____')}     ${CLI_TITLE}
    ${g('/  |/  /')}${gr('/ __ \\\\')}   
   ${g('/ /|_/ /')}${gr('/ /_/ /')}    ${CLI_DESCRIPTION}
  ${g('/ /  / /')}${gr('/ ____/')}     
 ${g('/_/  /_/')}${gr('/_/')}          ${CLI_USAGE}
`

const commands = {
  build,
  install,
  version: () => {
    const v = require('./package.json').version
    console.log('modpacker v%s', v)
  },
  help: () => {
    const optionDefinitions = [
      { name: 'command', type: String, defaultOption: true }
    ]

    const options = commandLineArgs(optionDefinitions, { argv: commandOptions })

    const sections = [
      {
        content: HELP_HEADER,
        raw: true
      },
      {
        header: 'Synopsis',
        content: '$ modpacker <options> <command>'
      },
      {
        header: 'Command List',
        content: [
          { name: 'build', summary: 'Build a modpack' },
          { name: 'version', summary: 'Print the version.' },
          { name: 'install', summary: 'Install a modpack' }
        ]
      },
      {
        content: 'Run `{bold modpacker help <command>}` for help with a specific command',
        raw: true
      }
    ]

    const commandHelp = {
      help: sections,
      build: [
        {
          header: 'modpacker build',
          content: ['Usage: modpacker build [options...]', 'Builds a modpack from a minecraft installation']
        },
        {
          header: 'Command Options',
          content: [
            { name: '--modpackPath [-p]', summary: 'Specify the path to your modpack location (i.e ~/.minecraft)' },
            { name: '--output [-o]', summary: 'Specify a directory to output the modpack tar.gz files into' }
          ]
        }
      ],
      version: [
        {
          header: 'modpacker version',
          content: 'Usage: modpacker version'
        }
      ],
      install: [
        {
          header: 'modpacker install',
          content: ['Usage: modpacker install <url> [options...]', 'Installs a modpack from a URL']
        }
      ]
    }

    let usage
    if (!commandHelp[options.command]) {
      usage = commandLineUsage(sections)
      if (options.command) usage += `\nInvalid command '${options.command}'`
    } else {
      usage = commandLineUsage(commandHelp[options.command])
    }
    console.log(usage)
  }
}

// TLA wrapper
// TODO(jaredallard): add help
const main = async () => {
  const fn = commands[options.command]
  if (fn) {
    await fn()
  } else {
    await commands.help()
  }
}

main()
