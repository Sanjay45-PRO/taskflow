const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Metro's file watcher crashes on Windows when native build tools (Gradle/CMake)
// create and delete temporary files inside android/.cxx while Metro is watching.
// Excluding these folders from the watcher fixes the ENOENT crash.
config.resolver.blockList = [
  /android\/\.cxx\/.*/,
  /android\/build\/.*/,
  /android\/app\/build\/.*/,
];

module.exports = config;
