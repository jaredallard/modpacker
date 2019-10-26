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
const os = require('os')
const async = require('async')
const log = require('signale');
const tar = require('tar')
const request = require('request')
const _ = {
  cloneDeep: require('lodash.clonedeep')
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

const MojangAuthResponse = {
  access_token: '',
  client_token: '',
  uuid: '',
  name: '',
  selected_profile: { name: '', id: '' },
  user_properties: '',
}

const ModpackerConfig = {
  version: 1,

  // forgeVersions we have locally installed
  forgeVersions: [],

  /**
   * @type {MojangAuthResponse}
   */
  auth: _.cloneDeep(MojangAuthResponse),

  /**
   * Hashmap of name -> config of installed modpacks
   * @type {Map<string, Modpack>}
   */
  installedModpacks: {}
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
 * @param {String} dir provide a dir to download the file into, if empty os.tmpdir() is used
 * @returns {String} path file was downloaded to
 */
const downloadFile = async (url, name, dir) => {
  const parsed = require('url').parse(url)

  if (!dir) {
    dir = path.join(os.tmpdir(), "modpacker")
  }

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
  const forgeURL = `http://files.minecraftforge.net/maven/net/minecraftforge/forge/${fv}/forge-${fv}-universal.jar`
  return downloadFile(forgeURL, "forge.jar", path.join(await getMinecraftHome(), 'forge/', config.forge.version))
}

/**
 * getMinecraftHome returns the home directory for modpacker
 * 
 * @returns {String} abs path to the minecraft home directory
 */
const getMinecraftHome = async () => {
  const home = path.join(os.homedir(), '.modpacker')

  // ensure it exists
  if (!await fs.pathExists(home)) {
    await fs.mkdirp(home)
  }

  return home
}

/**
 * saveModpackerConfig saves the current modpack config
 * @param {ModpackerConfig} config config to save
 */
const saveModpackerConfig = async config => {
  const configPath = path.join(await getMinecraftHome(), 'config.yaml')
  return fs.writeFile(configPath, yaml.safeDump(config))
}

/**
 * loadModpackerConfig loads the current modpack config
 * @returns {ModpackerConfig}
 */
const loadModpackerConfig = async () => {
  const configPath = path.join(await getMinecraftHome(), 'config.yaml')

  if (!await fs.pathExists(configPath)) {
    return _.cloneDeep(ModpackerConfig)
  }

  return yaml.safeLoad(await fs.readFile(configPath))
}

module.exports = {
  /**
   * getMinecraftHome returns the home directory for modpacker
   * 
   * @returns {String} abs path to the minecraft home directory
   */
  getMinecraftHome,

  /**
   * loadModpackerConfig loads the current modpack config
   * @returns {ModpackerConfig}
   */
  loadModpackerConfig,

  /**
   * loadAuth returns the stored auth object, null if not set
   * @returns {MojangAuthResponse|null} the stored auth object, null if not set
   */
  loadAuth: async () => {
    const config = await loadModpackerConfig()
    return config.auth || null
  },

  /**
   * saveAuth saves auth response from mojang into the modpacker config
   * @param {MojangAuthResponse}
   */
  saveAuth: async auth => {
    const config = await loadModpackerConfig()
    config.auth = auth
    return saveModpackerConfig(config)
  },

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
    const modpackerConfig = await loadModpackerConfig()

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

    const minecraftHome = path.join(await getMinecraftHome(), 'modpacks/', path.normalize(config.name).replace(/^(\.\.(\/|\\|$))+/, '').toLowerCase())

    log.info('installing modpack "%s" v%s (to %s)', config.name, config.version, minecraftHome)

    const forgeProfile = `${config.minecraft.version}-forge${config.minecraft.version}-${config.forge.version}`
    if (config.forge.version) {
      if (modpackerConfig.forgeVersions.indexOf(config.forge.version) === -1) {
        log.info('downloading forge ...')
        const forgeLoc = await downloadForge(config)

        modpackerConfig.forgeVersions.push(config.forge.version)
      } else {
        log.info('skipping forge install, already found profile %s', forgeProfile)
      }
    }

    if (!await fs.pathExists(minecraftHome)) {
      await fs.mkdirp(minecraftHome)
    }

    log.info("copying modpack into minecraft launcher ...")

    const folders = ['mods', 'config', 'modpack.yaml']

    for (const folder of folders) {
      log.info(" ... %s", folder)
      const src = path.join(tmpDir, folder)
      const dest = path.join(minecraftHome, folder)

      if (await fs.pathExists(dest)) {
        await fs.remove(dest)
      }

      if (fs.statSync(src).isDirectory()) {
        await fs.mkdir(dest)
      }

      await fs.copy(src, dest)
    }

    modpackerConfig.installedModpacks[config.name] = config

    await saveModpackerConfig(modpackerConfig)

    // cleanup
    await fs.remove(tmpDir)
  }
}
