/**
 * ModPacker - a mod pack creator
 * 
 * @author Jared Allard <jaredallard@outlook.com>
 * @license BSD-3-Clause
 * @version 1
 */

'use strict'

const fs = require('fs-extra')
const log = require('signale');
const modpack = require('./lib/modpack')
const path = require('path')

const optionDefinitions = [
  { name: 'command', defaultOption: true },
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

  const modpackPath = options['modpackPath'] || process.cwd()
  const outputPath = options['output'] || process.cwd()
  
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
    { name: 'url', type: String, defaultOption: true },
  ]

  const options = commandLineArgs(optionDefinitions, { argv: commandOptions })

  const modpackURL = options['url']
  if (!modpackURL) {
    log.fatal('please provide a modpack url')
    process.exit(1)
  }

  log.info('installing modpack from %s', modpackURL)
  try {
    await modpack.installModpack(modpackURL)
  } catch(err) {
    log.fatal('failed to install modpack: %s', err)
    process.exit(1)
  }
}

// TLA wrapper
const main = async () => {
  if (options.command === 'build') {
    await build()
  } else if (options.command === 'install') {
    await install()
  } else {
    // TODO(jaredallard): show help page here
    console.log('Invalid option')
  }
}

main()