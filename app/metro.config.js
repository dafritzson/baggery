// Lets Metro bundle the shared game logic that lives outside the app folder.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../supabase/functions/_shared')];

module.exports = config;
