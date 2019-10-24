/**
 * Modpack Library
 * 
 * @author Jared Allard <jaredallard@outlook.com>
 * @license BSD-3-Clause
 * @version 1
 */

'use strict'

const yaml = require('js-yaml')
const fs = require('fs-extra')
const path = require('path')
const klaw = require('klaw')
const os = require('os')
const async = require('async')
const log = require('signale');
const tar = require('tar')
const request = require('request')
const _ = {
  cloneDeep: require('lodash.clonedeep'),
  find: require('lodash.find')
}

const Mod = {
  filename: '',

  // client only mod or not
  client: false,
}

const Modpack = {
  version: '',
  name: '',
  author: '',

  minecraft: {
    version: '',

    // allows you to set recommended java args
    javaArgs: '',
  },
  forge: {
    version: '',
  },

  /**
   * @type Mod[]
   */
  mods: []
}

// ModpackGeneration is used for when a modpack is generated
const ModpackGeneration = {
  modpack: _.cloneDeep(Modpack),
  changes: {
    newMods: [],
    removedMods: [],
  }
}

/**
 * downloadFile downloads a file into a tmp directory and 
 * returns the location of it
 * @param {String} url url to download from
 * @param {String} name name of the file
 * @returns {String} path file was downloaded to
 */
const downloadFile = async (url, name) => {
  const parsed = require('url').parse(url)

  const dir = path.join(os.tmpdir(), "modpacker")
  if (!await fs.pathExists(dir)) {
    await fs.mkdirp(dir)
  }
  const downloadLoc = path.join(dir, name)

  if (parsed.protocol === 'file:') {
    await fs.copyFile(parsed.pathname, downloadLoc)
    return downloadLoc
  }

  return new Promise(resolve => {
    request(url)
      .pipe(fs.createWriteStream(downloadLoc))
      .on('close', () => {
        resolve(downloadLoc)
      })
  })
}

/**
 * downloadForge downloads and installs forge
 * @param {Modpack} config modpack config
 * @returns {String} path forge was downloaded to
 */
const downloadForge = async config => {
  const fv = `${config.minecraft.version}-${config.forge.version}`

  // http://files.minecraftforge.net/maven/net/minecraftforge/forge/1.12.2-14.23.5.2847/forge-1.12.2-14.23.5.2847-installer.jar
  const forgeURL = `http://files.minecraftforge.net/maven/net/minecraftforge/forge/${fv}/forge-${fv}-installer.jar`
  return downloadFile(forgeURL, "forge-installer.jar")
}

/**
 * installForge installs forge
 * @param {String} pth is the direct path forge jar was downloaded into
 */
const installForge = async pth => {
  return new Promise((resolve, reject) => {
    const spawn = require('child_process').spawn
    const child = spawn('java', ['-jar', pth])
    child.stdout.pipe(process.stdout)
    child.stderr.pipe(process.stderr)
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('java exited with a non-zero exit code'))
      }

      resolve()
    })
  })
}

/**
 * getDotMinecraft finds the minecraft directory for your platform
 * 
 */
const getDotMinecraft = async () => {
  const homedir = os.homedir()
  const locations = [
    path.join(homedir, '.minecraft'),
    path.join(homedir, 'Library/Application Support/.minecraft')
  ]

  if (process.env['MINECRAFT_HOME']) {
    let home = process.env['MINECRAFT_HOME']
    if (!path.isAbsolute(home)) {
      home = path.join(process.cwd(), path.normalize(process.env['MINECRAFT_HOME']))
    }
    locations.unshift(home)
  }

  let found = ''
  for (const loc of locations) {
    try {
      if (await fs.pathExists(loc)) {
        found = loc
      }
    } catch(err) {
      // ignore errors here
    }
  }

  if (!found) throw new Error('failed to find minecraft directory, set EnvVar MINECRAFT_HOME')
  return found
}

module.exports = {
  /**
   * loadModpackConfig loads a modpack config
   * 
   * @returns {Modpack} modpack configuration object
   */
  loadModpackConfig: async path => {
    const contents = await fs.readFile(path)
    const obj = yaml.safeLoad(contents) || {}

    const config = _.cloneDeep(Modpack)

    // iterate over the config objection and pluck values that match the "Modpack" schema, we don't
    // want to carry over any other extra data in the config
    Object.keys(config).forEach(k => typeof config[k] !== 'undefined'? config[k] = obj[k] : false)

    if (config.forge.version && !config.minecraft.version) {
      throw new Error('forge.version can only be set when minecraft.version is also set')
    }

    return config
  },

  /**
   * Build Modpack creates a modpack from a config
   * @param {Modpack} config modpack config
   * @param {String} pth path of the modpack
   * @returns {ModpackGeneration} generated modpack
   */
  buildModpack: async (config, pth) => {
    let modFiles = await fs.readdir(path.join(pth, 'mods'))
    modFiles = modFiles.filter(mod => !fs.statSync(path.join(pth, 'mods', mod)).isDirectory())

    console.log(modFiles)
    const foundModshm = {}
    for (const mod of modFiles) {
      foundModshm[mod] = true
    }

    const removedMods = []
    
    // iterate over the mods we supposedly have in our pack
    // and detect if they have been added or removed
    for (const mod of config.mods) {
      // already exists
      if (foundModshm[mod.filename]) {
        // delete the mod from the hm so that we don't consider it as new
        delete foundModshm[mod.filename]
        continue
      }

      removedMods.push(mod.filename)
    }

    
    // at this point any files left haven't been found
    // so we can just consider these as newMods
    const newMods = Object.keys(foundModshm) || []

    // we create an index map here of filenames so that we can get O(1) later on,
    // this is O(n) complexity however, but much better than making it potentially O(n*n)
    const modsIndexMap = {}
    for (let i=0; i !== config.mods.length-1; i++) {
      const k = config.mods[i]
      modsIndexMap[k.filename] = i
    }

    // using that modsIndexMap we created we can get O(1) lookup
    // on searching mods
    for (const mod of removedMods) {
      config.mods.splice(modsIndexMap[mod], 1)
    }

    // add new mods
    for (const mod of newMods) {
      config.mods.push({ filename: mod, client: false })
    }

    /**
     * @type {ModpackGeneration}
     */
    return {
      modpack: config,
      changes: {
        newMods,
        removedMods,
      },
    }
  },

  /**
   * bundleModpack creates archives for the modpack in a specified path
   * 
   * @param {Modpack} config modpack config
   * @param {String} modpackPath the path that the modpack base exists in
   * @param {String} storagePath path to store archives in
   */
  bundleModpack: async (config, modpackPath, storagePath) => {
    if (typeof config.mods !== 'object' || !Array.isArray(config.mods) || config.mods.length === 0) {
      throw new Error('Invalid config.mods type, expected non-empty array')
    }

    if (!await fs.pathExists(path.join(modpackPath, 'modpack.yaml'))) {
      throw new Error('modpack.yaml not found in modpack path')
    }

    const str = yaml.safeDump(config)
    await fs.writeFile(path.join(modpackPath, 'modpack.yaml'), str)

    // filter out all client mods from getting into the server archive
    const serverFiles = config.mods.filter(file => !file.client)

    const filename = `${config.name}-v${config.version}`

    const allPackFiles = config.mods.map(file => path.join('mods/', file.filename))
    const serverPackFiles = serverFiles.map(file => path.join('mods/', file.filename))

    let baseFiles = ['modpack.yaml', 'config']

    // create the client tar file
    const opts = {
      gzip: true,
      cwd: modpackPath
    }

    // TODO(jaredallard): just use the sync version
    return new Promise((resolve, reject) => {
      async.waterfall([
        next => {
          tar.create(
            opts,
            baseFiles.concat(serverPackFiles)
          )
            .pipe(fs.createWriteStream(path.join(storagePath, `${filename}-server.tar.gz`)))
            .on('close', next)
        },
        next => {
          tar.create(
            opts,
            baseFiles.concat(allPackFiles)
          )
            .pipe(fs.createWriteStream(path.join(storagePath, `${filename}.tar.gz`)))
            .on('close', next)
        }
      ], err => {
        if (err) return reject(err)
        resolve()
      })
    })
  },

  /**
   * installModPack installs a modpack
   * @param {String} url url to download
   */
  installModpack: async url => {
    const minecraftHome = await getDotMinecraft()

    log.info('downloading modpack ...')
    const fileLoc = await downloadFile(url, "modpack.tar.gz")
    const tmpDir = path.dirname(fileLoc)

    log.info('extracting modpack ...')
    tar.extract({
      file: fileLoc,
      sync: true,
      cwd: tmpDir,
    })

    let config
    try {
      config = await module.exports.loadModpackConfig(path.join(tmpDir, 'modpack.yaml'))
    } catch(err) {
      throw new Error(`Failed to load modpack.yaml from modpack. (is this a modpack?): ${err}`)
    }

    if (config.forge.version) {
      log.info('downloading forge ...')
      const forgeLoc = await downloadForge(config)

      log.info('running forge installer ...')
      try {
       await installForge(forgeLoc)
      } catch (err) {
        throw new Error(`failed to install forge: ${err}`)
      }
    }

    const profilesFile = path.join(minecraftHome, 'launcher_profiles.json')
    const profiles = JSON.parse(await fs.readFile(profilesFile))
    if (!profiles.profiles[config.name]) {
      log.info('creating modpack profile in the minecraft launcher')
      profiles.profiles[config.name] = {
        created: new Date().toISOString(),
        lastUsed: '1970-01-01T00:00:00.000Z',
        name: config.name,
        javaArgs: config.minecraft.javaArgs,

        // TODO(jaredallard): we probably want this to be "updateable"
        lastVersionId: `${config.minecraft.version}-forge${config.minecraft.version}-${config.forge.version}`,
        icon: 'Furnace',
        type: 'custom',
      }

      await fs.writeFile(profilesFile, JSON.stringify(profiles, 0, 2))
    }

    // cleanup
    await fs.remove(tmpDir)
  }
}
