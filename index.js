/**
 * ModPacker - a mod pack creator
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license BSD-3-Clause
 * @version 1
 */

'use strict'

const log = require('signale');
const commandLineUsage = require('command-line-usage')
const modpack = require('./lib/modpack')
const fs = require('fs-extra')
const path = require('path')
const chalk = require('chalk')
const commandLineArgs = require('command-line-args')
const promptly = require('promptly')
const inquirer = require('inquirer')
const { Client, Authenticator } = require('minecraft-launcher-core');
const optionDefinitions = [
  { name: 'command', defaultOption: true }
]

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
    log.fatal('Failed to load modpack.yaml: %s', err)
    process.exit(1)
  }

  log.info('building Modpack %s version %s', config.name, config.version)
  const manifest = await modpack.buildModpack(config, modpackPath)

  const { newMods, removedMods } = manifest.changes
  if (newMods.length === 0 && removedMods.length === 0) {
    log.warn('No mods were removed or added, this is a no-op unless you modified configs or options')
  } else {
    log.info('%d mods were added', newMods.length)
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
    log.fatal('failed to install modpack: %s', err.message || err)
    process.exit(1)
  }

  log.success('installed modpack')
}

const launch = async () => {
  const optionDefinitions = [
    { name: 'modpack', type: String, defaultOption: true }
  ]

  const options = commandLineArgs(optionDefinitions, { argv: commandOptions })

  const modpackName = options['modpack']
  if (!modpackName) {
    log.fatal('missing modpack name')
    process.exit(1)
  }

  const config = await modpack.loadModpackerConfig()
  const modpackConfig = config.installedModpacks[modpackName]

  if (!modpackConfig) {
    log.fatal('modpack %s isnt installed', modpackName)
    process.exit(1)
  }

  log.info('launching modpack %s', modpackName)

  const launcher = new Client()

  const opts = {
    authorization: await modpack.loadAuth(),
    root: path.join(await modpack.getMinecraftHome(), 'modpacks/', path.normalize(modpackName).replace(/^(\.\.(\/|\\|$))+/, '').toLowerCase()),

    // TODO(jaredallard): don't include this unless we need too
    forge: path.join(await modpack.getMinecraftHome(), 'forge/', modpackConfig.forge.version, 'forge.jar'),
    version: {
      number: modpackConfig.minecraft.version,
      type: "release"
    },
    memory: {
      max: "8000",
      min: "4000"
    }
  }

  launcher.launch(opts);

  launcher.on('debug', log.debug);
  launcher.on('data', data => process.stdout.write(Buffer.from(data)));
}

const login = async () => {
  let username, pass

  try {
    username = await promptly.prompt('Mojang Username/Email: ')
    pass = await promptly.password('Mojang Password: ')
  } catch (err) {
    console.log()
    log.fatal('failed to get user input: %s', err.message || err)
    process.exit(1)
  }

  let auth
  try {
    auth = await Authenticator.getAuth(username, pass)
  } catch(err) {
    log.fatal('failed to get login: %s', err.message || err)
    process.exit(1)
  }

  try {
    await modpack.saveAuth(auth)
  } catch(err) {
    log.fatal('failed to save auth: %s', err.message || err)
    process.exit(1)
  }

  log.success('logged in as %s', auth.name)
}

const g = chalk.green
const gr = chalk.grey

const CLI_TITLE = chalk.bold.underline('modpacker')
const CLI_DESCRIPTION = '✨ run and create modded minecraft installations from the CLI'
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
  login,
  launch,
  list: async () => {
    const config = await modpack.loadModpackerConfig()

    let reply = ''
    for (const modpackName of Object.keys(config.installedModpacks)) {
      const modpack = config.installedModpacks[modpackName]
      reply += `${modpack.name} v${modpack.version}`
    }

    if (!reply) {
      reply = 'No modpacks installed'
    }

    console.log(reply)
  },
  version: () => {
    // using fs.readFileSync here for nexe
    const v = JSON.parse(fs.readFileSync('./package.json')).version
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
          { name: 'install', summary: 'Install a modpack' },
          { name: 'login', summary: 'Login to a Mojang Account' },
          { name: 'launch', summary: 'Launch a modpack' },
          { name: 'list', summary: 'List installed modpacks' }
        ]
      },
      {
        content: 'Run `{bold modpacker help <command>}` for help with a specific command',
        raw: true
      }
    ]

    const commandHelp = {
      help: sections,
      launch: [
        {
          header: 'modpacker launch',
          content: ['Usage: modpacker launch <modpack-name> [options...]', 'Launches a modpack']
        },
        {
          header: 'Command Options',
          content: []
        }
      ],
      login: [
        {
          header: 'modpacker login',
          content: ['Usage: modpacker login [options...]', 'Login to Mojang servers for online-mode']
        },
        {
          header: 'Command Options',
          content: []
        }
      ],
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
const main = async () => {
  const fn = commands[options.command]
  if (fn) {
    await fn()
  } else {
    // assume we're running in an embedded scenario at first, if not then we'll just show the help screen
    const p = path.join(process.cwd(), "modpack.yaml")
    if (await fs.pathExists(p)) {
      log.info('running installing modpack in current directory and launching it ...')

      commandOptions[0] = process.cwd()
      await install()

      log.info('logging into minecraft')
      await login()


      log.info('launching modpack')
      const config = await modpack.loadModpackConfig(p)
      commandOptions[0] = config.name
      await launch()

      return
    } else { // check and see if we have any modpacks, just wrap launch then
      const config = await modpack.loadModpackerConfig()
      if (Object.keys(config.installedModpacks).length !== 0) {
        const choices = await inquirer
          .prompt({
            type: 'list',
            name: 'modpack',
            message: 'Which modpack would you like to launch? (^C to exit):',
            choices: Object.keys(config.installedModpacks)
          })
        
        if (!choices.modpack) {
          return
        }

        commandOptions[0] = choices.modpack
        await launch()
        return
      }

    }
    await commands.help()
  }
}

main()
