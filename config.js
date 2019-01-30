"use strict";

module.exports.SERVER_ORIGIN = process.env.SERVER_ORIGIN || 'http://127.0.0.1:8090';

module.exports.WEB_ALMOND_URL = process.env.WEB_ALMOND_URL || 'https://almond.stanford.edu';
module.exports.THINGPEDIA_URL = module.exports.WEB_ALMOND_URL + '/thingpedia';

module.exports.DATABASE_URL = process.env.DATABASE_URL || 'mysql://slackmond:slackmond@localhost/slackmond?charset=utf8mb4_bin';

module.exports.ALMOND_CLIENT_ID = process.env.ALMOND_CLIENT_ID || null;

module.exports.ALMOND_CLIENT_SECRET = process.env.ALMOND_CLIENT_SECRET || null;

module.exports.SLACK_ACCESS_TOKEN = process.env.SLACK_ACCESS_TOKEN || null;

module.exports.SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || null;

try {
    Object.assign(module.exports, require('./secret_config.js'));
} catch(e) {
    // ignore if there is no file
}
