/**
 * nexe build script
 * 
 * @author Jared Allard <jaredallard@outlook.com>
 * @license BSD-3-Clause
 * @version 1
 */

'use strict'

const nexe = require('nexe')
const path = require('path')
const fs = require('fs-extra')
const { Signale } = require('signale');
const log = new Signale({interactive: true});

const os = ['windows', 'mac', 'linux']
const archs = ['x86', 'x64']
const nodeVersion = '12.4.0'
const buildBase = path.join(__dirname, '../build')

// TLA wrapper
const build = async () => {
  const targets = []

  for (const target of os) {
    for (const arch of archs) {
      targets.push(`${target}-${arch}-${nodeVersion}`)
    }
  }

  log.info('creating build area ...')
  if (await fs.pathExists(buildBase)) {
    await fs.remove(buildBase)
  }

  await fs.mkdirp(buildBase)

  log.info('building %d target(s) ...', targets.length)

  for (let i = 0; i != targets.length; i++ ) {
    const target = targets[i]
    log.await('[%d/%d] - building %s', i+1, targets.length, target);
    const split = target.split('-')
    const output = `modpacker-${split[0]}-${split[1]}${target.indexOf('windows') !== -1 ? '.exe' : ''}` 
    await nexe.compile({
      input: 'index.js',
      name: 'modpacker',
      loglevel: 'silent',
      cwd: path.join(__dirname, '..'),
      output: path.join(buildBase, output),
    })

    log.success('[%d/%d] - built %s', i+1, targets.length, target);
  }
}

build()