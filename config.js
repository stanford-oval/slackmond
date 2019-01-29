module.exports.SLACK_ACCESS_TOKEN = process.env.SLACK_ACCESS_TOKEN || null;

module.exports.SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || null;

try {
    Object.assign(module.exports, require('./secret_config.js'));
} catch(e) {
    // ignore if there is no file
}
